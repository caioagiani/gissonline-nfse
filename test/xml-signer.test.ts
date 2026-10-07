import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignedXml } from "xml-crypto";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { buildDps, dpsId, type DpsContext } from "../src/providers/nacional/messages.ts";
import { PROVIDER_CNPJ, SUZANO, sampleRps, testCertificate } from "./helpers.ts";

const context: DpsContext = {
  environment: 2,
  cnpj: PROVIDER_CNPJ,
  cityCode: SUZANO,
  series: "1",
  number: "7",
  simplesOption: 3,
};

function signDps(algorithm?: "sha1" | "sha256") {
  const certificate = testCertificate();
  const id = dpsId(context);
  const xml = createXmlSigner(certificate, algorithm).sign(buildDps(sampleRps(), context), {
    referenceXPath: "//*[local-name(.)='infDPS']",
    id,
    targetXPath: "/*",
  });
  return { xml, id, certificate };
}

/** Confere a assinatura com a chave pública do próprio certificado. */
function verify(xml: string): boolean {
  const certificate = testCertificate();
  const signature = /<Signature[\s\S]*<\/Signature>/.exec(xml)?.[0];
  assert.ok(signature, "Signature ausente");
  const verifier = new SignedXml({ publicCert: certificate.certificatePem });
  verifier.loadSignature(signature);
  return verifier.checkSignature(xml);
}

describe("createXmlSigner", () => {
  it("assina a DPS com SHA-256 quando pedido", () => {
    const { xml } = signDps("sha256");
    assert.match(xml, /Algorithm="http:\/\/www\.w3\.org\/2001\/04\/xmldsig-more#rsa-sha256"/);
    assert.match(xml, /Algorithm="http:\/\/www\.w3\.org\/2001\/04\/xmlenc#sha256"/);
    assert.ok(verify(xml));
  });

  it("mantém SHA-1 como padrão, que é o que o GissOnline valida", () => {
    const { xml } = signDps();
    assert.match(xml, /xmldsig#rsa-sha1/);
    assert.match(xml, /xmldsig#sha1/);
    assert.ok(verify(xml));
  });

  it("referencia o Id da infDPS e põe a Signature depois dela, dentro da DPS", () => {
    const { xml, id } = signDps("sha256");
    assert.match(xml, new RegExp(`<Reference URI="#${id}">`));
    assert.match(xml, /<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
    assert.match(xml, /<\/Signature><\/DPS>$/);
  });

  it("leva só o certificado no KeyInfo", () => {
    const { xml, certificate } = signDps("sha256");
    assert.ok(
      xml.includes(
        `<KeyInfo><X509Data><X509Certificate>${certificate.certificateBase64}</X509Certificate></X509Data></KeyInfo>`,
      ),
    );
  });

  it("invalida a assinatura se o conteúdo mudar", () => {
    const { xml } = signDps("sha256");
    assert.equal(verify(xml.replace("<vServ>1500.00</vServ>", "<vServ>15.00</vServ>")), false);
  });
});
