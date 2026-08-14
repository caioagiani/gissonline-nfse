import { SignedXml } from "xml-crypto";
import type { Certificado } from "./cert.ts";

/**
 * Algoritmos exigidos pelo manual GissOnline (seção 6.3):
 * c14n 20010315 + rsa-sha1 + sha1. São fracos pelos padrões atuais, mas é o
 * que o Web Service valida — não trocar sem confirmar com a prefeitura.
 */
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export interface OpcoesAssinatura {
  /**
   * XPath do elemento assinado. Padrão: o elemento raiz do documento.
   * Para RPS individual, aponte para o InfRps correspondente.
   */
  xpath?: string;
  /** Valor do atributo Id referenciado na URI. Sem ele, assina o documento inteiro (URI=""). */
  id?: string;
  /** XPath do elemento que recebe a tag Signature. Padrão: o mesmo de `xpath`. */
  xpathDestino?: string;
}

/** Assina o XML no padrão XMLDSig enveloped exigido pelo GissOnline. */
export function assinarXml(
  xml: string,
  certificado: Certificado,
  opcoes: OpcoesAssinatura = {},
): string {
  const xpath = opcoes.xpath ?? "/*";
  const uri = opcoes.id ? `#${opcoes.id}` : "";

  const assinatura = new SignedXml({
    privateKey: certificado.chavePrivadaPem,
    publicCert: certificado.certificadoPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
    // O manual proíbe X509SubjectName/IssuerSerial/SKI — só o certificado.
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificado.certificadoBase64}</X509Certificate></X509Data>`,
  });

  assinatura.addReference({
    xpath,
    uri,
    isEmptyUri: uri === "",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });

  assinatura.computeSignature(xml, {
    location: { reference: opcoes.xpathDestino ?? xpath, action: "append" },
  });

  return assinatura.getSignedXml();
}
