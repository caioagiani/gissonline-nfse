import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

const CERT_BAG_OID = "1.2.840.113549.1.12.10.1.3";
const KEY_BAG_OID = "1.2.840.113549.1.12.10.1.1";
const SHROUDED_KEY_BAG_OID = "1.2.840.113549.1.12.10.1.2";

export interface Certificate {
  privateKeyPem: string;
  certificatePem: string;
  /** Certificados intermediários presentes no .pfx, enviados no handshake TLS */
  chainPem: string[];
  /** Certificado em base64 puro, sem cabeçalhos PEM (para o X509Certificate do XMLDSig) */
  certificateBase64: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
}

/**
 * De onde o certificado pode vir.
 *
 * O caminho de arquivo serve para uso local; o `Buffer` existe para quem
 * guarda o .pfx cifrado em banco e o decifra em memória, sem passar por
 * disco; e um `Certificate` já carregado é devolvido como está, o que
 * permite parseá-lo uma vez e reaproveitar entre requisições — o PKCS#12
 * legado é lento de abrir.
 */
export type CertificateInput = string | Buffer | Certificate;

/** Um `Certificate` já carregado, distinguido das fontes ainda por abrir. */
function isCertificate(input: CertificateInput): input is Certificate {
  return typeof input === "object" && !Buffer.isBuffer(input);
}

/**
 * Carrega o par chave/certificado do titular a partir de um PKCS#12 (.pfx).
 * Usa node-forge porque os PFX da ICP-Brasil costumam vir cifrados com
 * algoritmos legados que o OpenSSL 3 só aceita com o provider `legacy`.
 *
 * A senha é obrigatória exceto quando `input` já é um `Certificate`.
 */
export function loadCertificate(
  input: CertificateInput,
  password?: string,
): Certificate {
  if (isCertificate(input)) return input;
  if (password === undefined) {
    throw new Error("Informe a senha do certificado");
  }

  const pfx = typeof input === "string" ? readFileSync(input) : input;
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary"))),
    password,
  );

  const privateKey = findPrivateKey(p12);
  if (!privateKey) throw new Error("Nenhuma chave privada encontrada no certificado");

  const certificates = (p12.getBags({ bagType: CERT_BAG_OID })[CERT_BAG_OID] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));

  // O .pfx traz também a cadeia da AC; o do titular é o que casa com a chave.
  const certificate = certificates.find((cert) => {
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    return publicKey.n?.toString(16) === privateKey.n.toString(16);
  });
  if (!certificate) {
    throw new Error("Certificado do titular não encontrado no arquivo .pfx");
  }

  const certificatePem = forge.pki.certificateToPem(certificate);

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem,
    chainPem: certificates
      .filter((cert) => cert !== certificate)
      .map((cert) => forge.pki.certificateToPem(cert)),
    certificateBase64: certificatePem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
      .replace(/\s+/g, ""),
    subject: certificate.subject.getField("CN")?.value ?? "",
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
  };
}

export interface ExportedFiles {
  certificate: string;
  key: string;
  chain?: string;
  bundle: string;
}

/**
 * Grava o par extraído do .pfx em arquivos PEM — útil para testes com
 * `curl --cert cert.pem --key key.pem` ou `openssl`.
 * A chave sai sem senha: mantenha o diretório fora do controle de versão.
 */
export function exportPem(
  certificate: Certificate,
  directory: string,
): ExportedFiles {
  mkdirSync(directory, { recursive: true });

  const files: ExportedFiles = {
    certificate: join(directory, "cert.pem"),
    key: join(directory, "key.pem"),
    bundle: join(directory, "bundle.pem"),
  };

  writeFileSync(files.certificate, certificate.certificatePem, { mode: 0o600 });
  writeFileSync(files.key, certificate.privateKeyPem, { mode: 0o600 });
  writeFileSync(
    files.bundle,
    [certificate.certificatePem, ...certificate.chainPem].join(""),
    { mode: 0o600 },
  );

  if (certificate.chainPem.length > 0) {
    files.chain = join(directory, "chain.pem");
    writeFileSync(files.chain, certificate.chainPem.join(""), { mode: 0o600 });
  }

  return files;
}

function findPrivateKey(
  p12: forge.pkcs12.Pkcs12Pfx,
): forge.pki.rsa.PrivateKey | null {
  for (const oid of [SHROUDED_KEY_BAG_OID, KEY_BAG_OID]) {
    const bag = p12.getBags({ bagType: oid })[oid]?.[0];
    if (bag?.key) return bag.key as forge.pki.rsa.PrivateKey;
  }
  return null;
}
