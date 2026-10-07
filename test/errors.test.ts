import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHttpStatus,
  GissError,
  NationalError,
  NfseError,
  PortalError,
  SoapFaultError,
} from "../src/domain/errors.ts";
import { LookupError } from "../src/services/lookup-service.ts";

describe("classifyHttpStatus", () => {
  const cases: [number, string, boolean][] = [
    [400, "REJECTED", false],
    [401, "AUTHENTICATION", false],
    [403, "AUTHENTICATION", false],
    [404, "NOT_FOUND", false],
    [408, "UNAVAILABLE", true],
    [409, "REJECTED", false],
    [422, "REJECTED", false],
    [429, "UNAVAILABLE", true],
    [500, "UNAVAILABLE", true],
    [502, "UNAVAILABLE", true],
    [503, "UNAVAILABLE", true],
    [200, "UNEXPECTED_RESPONSE", false],
  ];
  for (const [status, code, retryable] of cases) {
    it(`HTTP ${status} → ${code}${retryable ? ", repetível" : ""}`, () => {
      assert.deepEqual(classifyHttpStatus(status), { code, retryable });
    });
  }
});

describe("hierarquia", () => {
  it("todo erro de serviço é um NfseError com provedor", () => {
    const errors = [
      new GissError("GerarNfse", [{ code: "E160", message: "fora do schema" }], "<x/>"),
      new SoapFaultError("GerarNfse", "falhou"),
      new PortalError("/rota", 500, { mensagem: "erro" }),
      new NationalError("/nfse", 400, [], {}),
      new LookupError("CNPJ 1", 429),
    ];
    for (const error of errors) {
      assert.ok(error instanceof NfseError, error.name);
      assert.ok(error instanceof Error);
      assert.ok(error.provider, `${error.name} sem provider`);
    }
  });

  it("GissError é recusa, não repetível, e guarda as mensagens", () => {
    const error = new GissError("GerarNfse", [{ code: "E160", message: "fora do schema" }], "<x/>");
    assert.equal(error.code, "REJECTED");
    assert.equal(error.provider, "giss");
    assert.equal(error.operation, "GerarNfse");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "GerarNfse: [E160] fora do schema");
  });

  it("SoapFaultError é resposta inesperada", () => {
    assert.equal(new SoapFaultError("GerarNfse", "x").code, "UNEXPECTED_RESPONSE");
  });

  it("PortalError herda código e repetição do status", () => {
    const error = new PortalError("/rota", 503, { mensagem: "fora do ar" });
    assert.equal(error.code, "UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.equal(error.message, "/rota → HTTP 503: fora do ar");
  });

  it("NationalError monta a mensagem com os códigos do serviço", () => {
    const error = new NationalError("/nfse", 400, [{ code: "E0039", message: "não parametrizado" }], {});
    assert.equal(error.code, "REJECTED");
    assert.equal(error.provider, "nacional");
    assert.equal(error.message, "/nfse → HTTP 400: [E0039] não parametrizado");
  });

  it("NationalError com HTML resume o texto", () => {
    const error = new NationalError("/danfse/x", 503, [], "<html><body><h1>503</h1> No server</body></html>");
    assert.equal(error.message, "/danfse/x → HTTP 503: 503 No server");
    assert.equal(error.retryable, true);
  });

  it("LookupError é repetível só no limite de requisições", () => {
    assert.equal(new LookupError("CEP 1", 429).retryable, true);
    assert.equal(new LookupError("CEP 1", 404).code, "NOT_FOUND");
  });

  it("preserva a causa", () => {
    const cause = new Error("raiz");
    const error = new NfseError("x", { code: "TRANSPORT", cause });
    assert.equal(error.cause, cause);
    assert.deepEqual(error.details, {});
    assert.equal(error.outcomeUnknown, false);
  });
});
