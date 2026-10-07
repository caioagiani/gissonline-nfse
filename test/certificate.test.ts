import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CertificateError } from "../src/domain/errors.ts";
import { loadCertificate } from "../src/infra/certificate.ts";
import { testCertificate, testPfx } from "./helpers.ts";

describe("loadCertificate", () => {
  const pfx = testPfx("segredo");

  it("abre o .pfx com a senha certa", () => {
    const certificate = loadCertificate(pfx, "segredo");
    assert.equal(certificate.subject, "EMPRESA TESTE:37969249000110");
    assert.equal(certificate.certificatePem, testCertificate().certificatePem);
    assert.match(certificate.privateKeyPem, /BEGIN RSA PRIVATE KEY/);
    assert.deepEqual(certificate.chainPem, []);
  });

  it("senha errada diz que é a senha", () => {
    assert.throws(
      () => loadCertificate(pfx, "errada"),
      (error: unknown) =>
        error instanceof CertificateError && error.message === "Senha do certificado incorreta",
    );
  });

  it("arquivo que não é PKCS#12", () => {
    assert.throws(() => loadCertificate(Buffer.from("não sou um pfx"), "x"), /não é um PKCS#12/);
  });

  it("caminho inexistente", () => {
    assert.throws(
      () => loadCertificate("/caminho/que/nao/existe.pfx", "x"),
      (error: unknown) =>
        error instanceof CertificateError &&
        /Não foi possível ler o certificado/.test(error.message) &&
        error.details["path"] === "/caminho/que/nao/existe.pfx",
    );
  });

  it("sem senha", () => {
    assert.throws(() => loadCertificate(pfx), CertificateError);
  });

  it("um Certificate já carregado volta como está", () => {
    const loaded = testCertificate();
    assert.equal(loadCertificate(loaded), loaded);
  });
});
