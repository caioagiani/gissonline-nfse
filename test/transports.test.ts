import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { CertificateError, NfseError, PortalError, TransportError } from "../src/domain/errors.ts";
import { requestBinary, requestJson } from "../src/infra/http-client.ts";
import { callNational } from "../src/infra/national-client.ts";
import { callSoap, readSoapResponse } from "../src/infra/soap-client.ts";
import { certificateValid, testCertificate } from "./helpers.ts";

/** Porta que ninguém escuta: abre e fecha um servidor para ganhar um número livre. */
async function closedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("transporte nacional (sockets reais)", () => {
  const certificate = testCertificate();
  const silent = createTcpServer(() => {
    // aceita a conexão e nunca responde — nem o handshake TLS
  });
  const untrusted = createHttpsServer(
    { key: certificate.privateKeyPem, cert: certificate.certificatePem },
    (_, res) => res.end("{}"),
  );
  let silentPort = 0;
  let untrustedPort = 0;

  before(async () => {
    silentPort = await listen(silent);
    untrustedPort = await listen(untrusted as unknown as Server);
  });
  after(() => {
    silent.close();
    untrusted.close();
    silent.unref();
  });

  it("conexão recusada: TransportError repetível, sem resultado incerto em leitura", async () => {
    const port = await closedPort();
    await assert.rejects(callNational(`https://127.0.0.1:${port}/nfse/x`, { certificate }), (error) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.details["errno"], "ECONNREFUSED");
      assert.equal(error.retryable, true);
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.operation, "GET /nfse/x");
      return true;
    });
  });

  it("servidor mudo: tempo esgotado, e em POST o resultado fica incerto", async () => {
    await assert.rejects(
      callNational(`https://127.0.0.1:${silentPort}/SefinNacional/nfse`, {
        certificate,
        method: "POST",
        json: {},
        timeoutMs: 200,
      }),
      (error) => {
        assert.ok(error instanceof TransportError);
        assert.equal(error.details["errno"], "ETIMEDOUT");
        assert.equal(error.outcomeUnknown, true);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });

  it("certificado do servidor não confiável: não repetível", async () => {
    await assert.rejects(callNational(`https://127.0.0.1:${untrustedPort}/`, { certificate }), (error) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.retryable, false);
      assert.match(error.message, /certificado do servidor/);
      return true;
    });
  });

  it("certificado vencido nem chega a conectar", async () => {
    const port = await closedPort();
    await assert.rejects(
      callNational(`https://127.0.0.1:${port}/`, {
        certificate: certificateValid("2020-01-01", "2021-01-01"),
      }),
      CertificateError,
    );
  });
});

describe("transporte SOAP do GissOnline", () => {
  const certificate = testCertificate();

  it("conexão recusada em operação de escrita: resultado incerto", async () => {
    const port = await closedPort();
    await assert.rejects(
      callSoap("RecepcionarLoteRps", "<x/>", {
        host: `https://127.0.0.1:${port}`,
        service: "nfse",
        certificate,
      }),
      (error) => {
        assert.ok(error instanceof TransportError);
        assert.equal(error.provider, "giss");
        assert.equal(error.operation, "RecepcionarLoteRps");
        assert.equal(error.outcomeUnknown, true);
        assert.match(error.message, /mesmo número de RPS/);
        return true;
      },
    );
  });

  it("consulta que falha não deixa resultado incerto", async () => {
    const port = await closedPort();
    await assert.rejects(
      callSoap("ConsultarNfsePorRps", "<x/>", { host: `https://127.0.0.1:${port}`, service: "nfse", certificate }),
      (error) => error instanceof TransportError && !error.outcomeUnknown,
    );
  });

  it("certificado vencido é recusado antes do envio", async () => {
    await assert.rejects(
      callSoap("GerarNfse", "<x/>", {
        host: "https://127.0.0.1:1",
        service: "nfse",
        certificate: certificateValid("2020-01-01", "2021-01-01"),
      }),
      CertificateError,
    );
  });

  describe("readSoapResponse", () => {
    const envelope = (inner: string) =>
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

    it("desembrulha o outputXML", () => {
      const response = readSoapResponse(
        "GerarNfse",
        200,
        envelope("<ns:GerarNfseResponse><outputXML>&lt;ok/&gt;</outputXML></ns:GerarNfseResponse>"),
      );
      assert.equal(response.xml, "<ok/>");
    });

    it("fault vira SoapFaultError, mesmo com 500", () => {
      assert.throws(
        () => readSoapResponse("GerarNfse", 500, envelope("<soap:Fault><faultstring>schema</faultstring></soap:Fault>")),
        (error: unknown) => error instanceof NfseError && error.code === "UNEXPECTED_RESPONSE" && /schema/.test(error.message),
      );
    });

    it("HTML com 503 é serviço indisponível, repetível", () => {
      assert.throws(
        () => readSoapResponse("GerarNfse", 503, "<html>Service Unavailable</html>"),
        (error: unknown) =>
          error instanceof NfseError && error.code === "UNAVAILABLE" && error.retryable,
      );
    });

    it("200 sem outputXML é resposta inesperada", () => {
      assert.throws(
        () => readSoapResponse("GerarNfse", 200, "<html/>"),
        (error: unknown) => error instanceof NfseError && error.code === "UNEXPECTED_RESPONSE",
      );
    });
  });
});

describe("transporte do portal (HTTP local)", () => {
  const routes: Record<string, (res: import("node:http").ServerResponse) => void> = {
    "/ok": (res) => res.writeHead(200, { "Content-Type": "application/json" }).end('{"a":1}'),
    "/down": (res) => res.writeHead(503).end("<html>down</html>"),
    "/denied": (res) => res.writeHead(401, { "Content-Type": "application/json" }).end('{"mensagem":"token inválido"}'),
    "/pdf": (res) => res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF"),
    "/pdf-error": (res) => res.writeHead(200, { "Content-Type": "application/json" }).end('{"mensagem":"nota não encontrada"}'),
  };
  const server = createHttpServer((req, res) => routes[req.url ?? ""]?.(res) ?? res.writeHead(404).end());
  let base = "";

  before(async () => {
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  after(() => server.close());

  it("lê JSON", async () => {
    assert.deepEqual(await requestJson(base, "/ok", {}), { a: 1 });
  });

  it("503 é indisponível e repetível", async () => {
    await assert.rejects(requestJson(base, "/down", {}), (error) => {
      assert.ok(error instanceof PortalError);
      assert.equal(error.code, "UNAVAILABLE");
      assert.equal(error.retryable, true);
      return true;
    });
  });

  it("401 é falha de autenticação com a mensagem do portal", async () => {
    await assert.rejects(requestJson(base, "/denied", {}), (error) => {
      assert.ok(error instanceof PortalError);
      assert.equal(error.code, "AUTHENTICATION");
      assert.match(error.message, /token inválido/);
      return true;
    });
  });

  it("devolve o arquivo quando o tipo confere", async () => {
    assert.equal((await requestBinary(base, "/pdf", {}, "application/pdf")).toString(), "%PDF");
  });

  it("erro com HTTP 200 não é salvo como PDF", async () => {
    await assert.rejects(requestBinary(base, "/pdf-error", {}, "application/pdf"), /nota não encontrada/);
  });

  it("portal fora do ar: TransportError", async () => {
    const port = await closedPort();
    await assert.rejects(requestJson(`http://127.0.0.1:${port}`, "/x", {}), (error) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.provider, "portal");
      assert.equal(error.details["errno"], "ECONNREFUSED");
      return true;
    });
  });

  it("login (POST) não é tratado como escrita incerta", async () => {
    const port = await closedPort();
    await assert.rejects(
      requestJson(`http://127.0.0.1:${port}`, "/service-empresa/api/login/token", { method: "POST" }),
      (error) => error instanceof TransportError && !error.outcomeUnknown,
    );
  });

  it("cadastro (POST) que falha deixa resultado incerto", async () => {
    const port = await closedPort();
    await assert.rejects(
      requestJson(`http://127.0.0.1:${port}`, "/service-empresa/api/cadastro", { method: "POST" }),
      (error) => error instanceof TransportError && error.outcomeUnknown,
    );
  });
});
