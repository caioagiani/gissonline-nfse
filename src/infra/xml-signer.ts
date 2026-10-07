import { SignedXml } from "xml-crypto";
import type { SignatureTarget, XmlSigner } from "../domain/signature-policy.ts";
import type { Certificate } from "./certificate.ts";

/**
 * Algoritmos exigidos pelo manual GissOnline (seção 6.3):
 * c14n 20010315 + rsa-sha1 + sha1. São fracos pelos padrões atuais, mas é o
 * que o Web Service valida — não trocar sem confirmar com a prefeitura.
 */
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/**
 * O GissOnline só valida SHA-1. O Sistema Nacional NFS-e aceita SHA-256 — e é
 * o que vale usar lá, já que nada obriga a herdar o algoritmo fraco.
 */
const ALGORITHMS = {
  sha1: {
    signature: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    digest: "http://www.w3.org/2000/09/xmldsig#sha1",
  },
  sha256: {
    signature: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    digest: "http://www.w3.org/2001/04/xmlenc#sha256",
  },
} as const;

export type SignatureAlgorithm = keyof typeof ALGORITHMS;

/** Assinador XMLDSig enveloped, no formato aceito pelo GissOnline. */
export function createXmlSigner(
  certificate: Certificate,
  algorithm: SignatureAlgorithm = "sha1",
): XmlSigner {
  const { signature: signatureAlgorithm, digest } = ALGORITHMS[algorithm];
  return {
    sign(xml: string, target: SignatureTarget = {}): string {
      const referenceXPath = target.referenceXPath ?? "/*";
      const uri = target.id ? `#${target.id}` : "";

      const signature = new SignedXml({
        privateKey: certificate.privateKeyPem,
        publicCert: certificate.certificatePem,
        signatureAlgorithm,
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
        digestAlgorithm: digest,
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
