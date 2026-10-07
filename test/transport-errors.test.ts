import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CertificateError,
  NfseError,
  TransportError,
  ValidationError,
} from "../src/domain/errors.ts";
import {
  assertCertificateUsable,
  classifyTransportError,
  timeoutError,
} from "../src/infra/transport-errors.ts";
import { certificateValid } from "./helpers.ts";

const nodeError = (code: string, message = code) => Object.assign(new Error(message), { code });
const read = { provider: "nacional" as const, operation: "GET /nfse/x" };
const write = { provider: "nacional" as const, operation: "POST /nfse", write: true };

describe("classifyTransportError", () => {
  for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE"]) {
    it(`${code} é falha de rede repetível`, () => {
      const error = classifyTransportError(nodeError(code), read);
      assert.ok(error instanceof TransportError);
      assert.equal(error.code, "TRANSPORT");
      assert.equal(error.retryable, true);
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.details["errno"], code);
    });
  }

  it("em escrita, marca o resultado como incerto e diz como repetir", () => {
    const error = classifyTransportError(nodeError("ECONNRESET", "socket hang up"), write);
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /POST \/nfse \(nacional\): falha de rede — socket hang up/);
    assert.match(error.message, /mesma série e número de DPS/);
  });

  it("a dica de repetição muda por provedor", () => {
    const giss = classifyTransportError(nodeError("ECONNRESET"), {
      provider: "giss",
      operation: "RecepcionarLoteRps",
      write: true,
    });
    assert.match(giss.message, /mesmo número de RPS/);
    const portal = classifyTransportError(nodeError("ECONNRESET"), {
      provider: "portal",
      operation: "/cadastro",
      write: true,
    });
    assert.match(portal.message, /confira o resultado no portal/);
  });

  it("acha o código dentro do `cause` do fetch", () => {
    const fetchError = new TypeError("fetch failed", { cause: nodeError("ECONNREFUSED") });
    const error = classifyTransportError(fetchError, read);
    assert.equal(error.details["errno"], "ECONNREFUSED");
    assert.equal(error.cause, fetchError);
  });

  it("tempo esgotado vira ETIMEDOUT", () => {
    const error = classifyTransportError(timeoutError(500), write);
    assert.equal(error.details["errno"], "ETIMEDOUT");
    assert.match(error.message, /tempo esgotado após 500ms/);
    assert.equal(error.retryable, true);
  });

  it("certificado recusado no handshake é erro de certificado, não repetível", () => {
    const error = classifyTransportError(nodeError("ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED"), read);
    assert.ok(error instanceof CertificateError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /recusou o certificado A1/);
  });

  it("certificado do servidor não confiável não é repetível", () => {
    const error = classifyTransportError(nodeError("SELF_SIGNED_CERT_IN_CHAIN"), read);
    assert.ok(error instanceof TransportError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /certificado do servidor/);
  });

  it("um NfseError passa sem ser embrulhado", () => {
    const original = new ValidationError("x");
    assert.equal(classifyTransportError(original, read), original);
  });

  it("falha sem código ainda vira TransportError", () => {
    const error = classifyTransportError("algo estranho", read);
    assert.ok(error instanceof NfseError);
    assert.equal(error.code, "TRANSPORT");
    assert.match(error.message, /algo estranho/);
  });
});

describe("assertCertificateUsable", () => {
  const now = new Date("2026-10-06T12:00:00Z");

  it("aceita certificado dentro da validade", () => {
    assert.doesNotThrow(() =>
      assertCertificateUsable(certificateValid("2026-01-01", "2027-01-01"), read, now),
    );
  });

  it("recusa certificado vencido com a data", () => {
    assert.throws(
      () => assertCertificateUsable(certificateValid("2025-01-01", "2026-10-05"), read, now),
      (error: unknown) =>
        error instanceof CertificateError &&
        /vencido em 2026-10-05/.test(error.message) &&
        error.provider === "nacional",
    );
  });

  it("recusa certificado que ainda não vale", () => {
    assert.throws(
      () => assertCertificateUsable(certificateValid("2026-11-01", "2027-11-01"), read, now),
      /só vale a partir de 2026-11-01/,
    );
  });
});
