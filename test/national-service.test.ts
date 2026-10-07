import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NationalError } from "../src/domain/errors.ts";
import { packXml, unpackXml } from "../src/providers/nacional/national-client.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { NATIONAL_HOSTS, NationalService } from "../src/providers/nacional/national-service.ts";
import {
  fakeTransport,
  PROVIDER_CNPJ,
  SUZANO,
  sampleRps,
  testCertificate,
  type RecordedCall,
} from "./helpers.ts";

const NFSE_XML = readFileSync(new URL("./fixtures/nfse-nacional.xml", import.meta.url), "utf8");
const ACCESS_KEY = "35525021237969249000110000000000058126100000000001";
const DPS_ID = "DPS355250223796924900011000001000000000000007";
const { sefin, adn } = NATIONAL_HOSTS.homologacao;
const issueOptions = { series: "1", number: "7", simplesOption: 3 } as const;

function service(
  routes: Parameters<typeof fakeTransport>[0],
  environment: "producao" | "homologacao" = "homologacao",
) {
  const { transport, calls } = fakeTransport(routes);
  const certificate = testCertificate();
  const national = new NationalService({
    certificate,
    signer: createXmlSigner(certificate, "sha256"),
    environment,
    cnpj: PROVIDER_CNPJ,
    cityCode: SUZANO,
    transport,
  });
  return { national, calls };
}

const notFound = () => ({ status: 404, json: { erro: { codigo: "E2401" } } });
const html404 = () => ({ status: 404, body: Buffer.from("<html>not found</html>") });
const posted = (call: RecordedCall) => call.request.json as Record<string, string>;

describe("NationalService — hosts", () => {
  it("homologação aponta para a produção restrita", () => {
    const { national } = service({});
    assert.equal(national.environmentCode, 2);
    assert.match(national.hosts.sefin, /producaorestrita/);
  });

  it("produção aponta para os hosts oficiais", () => {
    const { national } = service({}, "producao");
    assert.equal(national.environmentCode, 1);
    assert.equal(national.hosts.sefin, "https://sefin.nfse.gov.br/SefinNacional");
    assert.equal(national.hosts.adn, "https://adn.nfse.gov.br");
  });
});

describe("NationalService.agreement", () => {
  it("lê as duas flags do convênio do município", async () => {
    const { national, calls } = service({
      [`${adn}/parametrizacao/${SUZANO}/convenio`]: () => ({
        json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 0 } },
      }),
    });
    const agreement = await national.agreement();
    assert.equal(agreement.sharesWithNational, true);
    assert.equal(agreement.usesNationalIssuer, false);
    assert.equal(calls[0]?.request.certificate, testCertificate());
  });

  it("consulta outro município quando informado", async () => {
    const { national, calls } = service({
      [`${adn}/parametrizacao/3550308/convenio`]: () => ({
        json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 1 } },
      }),
    });
    assert.equal((await national.agreement("3550308")).usesNationalIssuer, true);
    assert.equal(calls.length, 1);
  });
});

describe("NationalService.issue", () => {
  it("envia a DPS assinada, compactada, e devolve a nota", async () => {
    const { national, calls } = service({
      [`${sefin}/dps/`]: notFound,
      [`${sefin}/nfse`]: () => ({
        status: 201,
        json: {
          chaveAcesso: ACCESS_KEY,
          nfseXmlGZipB64: packXml(NFSE_XML),
          alertas: [{ Codigo: "A001", Descricao: "Alerta de teste" }],
        },
      }),
    });

    const outcome = await national.issue(sampleRps(), issueOptions);

    assert.equal(outcome.status, "issued");
    assert.equal(outcome.dpsId, DPS_ID);
    assert.equal(outcome.nfse.accessKey, ACCESS_KEY);
    assert.deepEqual(outcome.alerts, [{ code: "A001", message: "Alerta de teste", correction: undefined }]);

    assert.equal(calls[0]?.url, `${sefin}/dps/${DPS_ID}`);
    const send = calls[1]!;
    assert.equal(send.url, `${sefin}/nfse`);
    assert.equal(send.request.method, "POST");
    const dps = unpackXml(posted(send)["dpsXmlGZipB64"]!);
    assert.match(dps, /<tpAmb>2<\/tpAmb>/);
    assert.match(dps, /<\/infDPS><Signature /);
    assert.match(dps, /rsa-sha256/);
  });

  it("não reenvia uma DPS que já virou nota", async () => {
    const { national, calls } = service({
      [`${sefin}/dps/`]: () => ({ json: { chaveAcesso: ACCESS_KEY } }),
      [`${sefin}/nfse/${ACCESS_KEY}`]: () => ({ json: { nfseXmlGZipB64: packXml(NFSE_XML) } }),
    });

    const outcome = await national.issue(sampleRps(), issueOptions);

    assert.equal(outcome.status, "already-issued");
    assert.equal(outcome.nfse.number, "581");
    assert.ok(calls.every((c) => c.request.method !== "POST"));
  });

  it("transforma a recusa em NationalError com os códigos", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: html404,
      [`${sefin}/nfse`]: () => ({
        status: 400,
        json: {
          idDPS: DPS_ID,
          erros: [{ Codigo: "E0039", Descricao: "Município não parametrizado", Complemento: "x" }],
        },
      }),
    });

    await assert.rejects(national.issue(sampleRps(), issueOptions), (error: unknown) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.messages, [
        { code: "E0039", message: "Município não parametrizado", correction: "x" },
      ]);
      assert.match(error.message, /\/SefinNacional\/nfse → HTTP 400: \[E0039\]/);
      return true;
    });
  });

  it("recusa resposta de sucesso sem a nota", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: notFound,
      [`${sefin}/nfse`]: () => ({ status: 201, json: { chaveAcesso: ACCESS_KEY } }),
    });
    await assert.rejects(national.issue(sampleRps(), issueOptions), NationalError);
  });

  it("previewDps não toca a rede", () => {
    const { national, calls } = service({});
    const xml = national.previewDps(sampleRps(), issueOptions);
    assert.match(xml, new RegExp(`Id="${DPS_ID}"`));
    assert.equal(calls.length, 0);
  });
});

describe("NationalService.findByDps / get", () => {
  it("devolve null quando a DPS não existe", async () => {
    const { national } = service({ [`${sefin}/dps/`]: notFound });
    assert.equal(await national.findByDps(DPS_ID), null);
  });

  it("propaga erros que não são 404", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: () => ({ status: 503, body: Buffer.from("Service Unavailable") }),
    });
    await assert.rejects(national.findByDps(DPS_ID), /HTTP 503: Service Unavailable/);
  });

  it("lê o erro no formato singular da consulta", async () => {
    const { national } = service({
      [`${sefin}/nfse/`]: () => ({
        status: 404,
        json: { erro: { codigo: "E2401", descricao: "Chave de acesso não encontrada." } },
      }),
    });
    await assert.rejects(national.get(ACCESS_KEY), (error: unknown) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.messages[0]?.code, "E2401");
      return true;
    });
  });

  it("recusa HTML onde se esperava JSON", async () => {
    const { national } = service({
      [`${sefin}/nfse/`]: () => ({ status: 200, body: Buffer.from("<html/>") }),
    });
    await assert.rejects(national.get(ACCESS_KEY), NationalError);
  });
});

describe("NationalService.pdf", () => {
  it("devolve o PDF do DANFSe", async () => {
    const pdf = Buffer.from("%PDF-1.4 teste");
    const { national, calls } = service({
      [`${adn}/danfse/`]: () => ({ contentType: "application/pdf", body: pdf }),
    });
    assert.deepEqual(await national.pdf(ACCESS_KEY), pdf);
    assert.equal(calls[0]?.url, `${adn}/danfse/${ACCESS_KEY}`);
  });

  it("não aceita um erro com HTTP 200 como se fosse PDF", async () => {
    const { national } = service({
      [`${adn}/danfse/`]: () => ({ json: { erro: { codigo: "E1", descricao: "falhou" } } }),
    });
    await assert.rejects(national.pdf(ACCESS_KEY), /\[E1\] falhou/);
  });
});

describe("NationalService.cancel", () => {
  it("registra o evento 101101 assinado na chave da nota", async () => {
    const { national, calls } = service({
      [`${sefin}/nfse/${ACCESS_KEY}/eventos`]: () => ({
        status: 201,
        json: { eventoXmlGZipB64: packXml("<evento/>") },
      }),
    });

    const event = await national.cancel(ACCESS_KEY, 2, "Servico nao foi prestado");

    assert.equal(event, "<evento/>");
    const call = calls[0]!;
    assert.equal(call.request.method, "POST");
    const request = unpackXml(posted(call)["pedidoRegistroEventoXmlGZipB64"]!);
    assert.match(request, new RegExp(`<infPedReg Id="PRE${ACCESS_KEY}101101">`));
    assert.match(request, /<cMotivo>2<\/cMotivo>/);
    assert.match(request, new RegExp(`<Reference URI="#PRE${ACCESS_KEY}101101">`));
    assert.match(request, /<\/infPedReg><Signature /);
  });

  it("valida a justificativa antes de enviar", async () => {
    const { national, calls } = service({});
    await assert.rejects(national.cancel(ACCESS_KEY, 1, "curta"), /15 a 255/);
    assert.equal(calls.length, 0);
  });
});

describe("NationalService.distribution", () => {
  it("descompacta os documentos do lote", async () => {
    const { national, calls } = service({
      [`${adn}/contribuintes/DFe/`]: () => ({
        json: {
          StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
          LoteDFe: [
            { NSU: 79, ChaveAcesso: ACCESS_KEY, TipoDocumento: "NFSE", ArquivoXml: packXml(NFSE_XML) },
          ],
        },
      }),
    });

    const documents = await national.distribution(78);

    assert.equal(calls[0]?.url, `${adn}/contribuintes/DFe/78?lote=true`);
    assert.deepEqual(documents, [{ nsu: 79, accessKey: ACCESS_KEY, type: "NFSE", xml: NFSE_XML }]);
  });

  it("lista vazia quando não há nada depois do NSU", async () => {
    const { national } = service({
      [`${adn}/contribuintes/DFe/`]: () => ({ status: 404, json: { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" } }),
    });
    assert.deepEqual(await national.distribution(500), []);
  });
});
