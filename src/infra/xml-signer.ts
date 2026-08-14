import { SignedXml } from "xml-crypto";
import type { SignatureTarget, XmlSigner } from "../domain/signature-policy.ts";
import type { Certificate } from "./certificate.ts";

/**
 * Algoritmos exigidos pelo manual GissOnline (seção 6.3):
 * c14n 20010315 + rsa-sha1 + sha1. São fracos pelos padrões atuais, mas é o
 * que o Web Service valida — não trocar sem confirmar com a prefeitura.
 */
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/** Assinador XMLDSig enveloped, no formato aceito pelo GissOnline. */
export function createXmlSigner(certificate: Certificate): XmlSigner {
  return {
    sign(xml: string, target: SignatureTarget = {}): string {
      const referenceXPath = target.referenceXPath ?? "/*";
      const uri = target.id ? `#${target.id}` : "";

      const signature = new SignedXml({
        privateKey: certificate.privateKeyPem,
        publicCert: certificate.certificatePem,
        signatureAlgorithm: RSA_SHA1,
        canonicalizationAlgorithm: C14N,
        // O manual proíbe X509SubjectName/IssuerSerial/SKI — só o certificado.
        getKeyInfoContent: () =>
          `<X509Data><X509Certificate>${certificate.certificateBase64}</X509Certificate></X509Data>`,
      });

      signature.addReference({
        xpath: referenceXPath,
        uri,
        isEmptyUri: uri === "",
        transforms: [ENVELOPED, C14N],
        digestAlgorithm: SHA1,
      });

      signature.computeSignature(xml, {
        location: {
          reference: target.targetXPath ?? referenceXPath,
          action: "append",
        },
      });

      return signature.getSignedXml();
    },
  };
}
