import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

const OID_CERT = "1.2.840.113549.1.12.10.1.3"; // certBag
const OID_CHAVE = "1.2.840.113549.1.12.10.1.1"; // keyBag
const OID_CHAVE_CIFRADA = "1.2.840.113549.1.12.10.1.2"; // pkcs8ShroudedKeyBag

export interface Certificado {
  chavePrivadaPem: string;
  certificadoPem: string;
  /** Certificados intermediários presentes no .pfx, enviados no handshake TLS */
  cadeiaPem: string[];
  /** Certificado em base64 puro, sem cabeçalhos PEM (para o X509Certificate do XMLDSig) */
  certificadoBase64: string;
  titular: string;
  validoDe: Date;
  validoAte: Date;
}

/**
 * Lê o PKCS#12 (.pfx) e extrai o par chave/certificado do titular.
 * Usa node-forge porque os PFX da ICP-Brasil costumam vir cifrados com
 * algoritmos legados que o OpenSSL 3 só aceita com o provider `legacy`.
 */
export function carregarCertificado(caminho: string, senha: string): Certificado {
  const pfx = readFileSync(caminho);
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary"))),
    senha,
  );

  const chave = primeiraChave(p12);
  if (!chave) throw new Error("Nenhuma chave privada encontrada no certificado");

  const certificados = (p12.getBags({ bagType: OID_CERT })[OID_CERT] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));

  // O .pfx traz também a cadeia da AC; o do titular é o que casa com a chave.
  const certificado = certificados.find((cert) => {
    const publica = cert.publicKey as forge.pki.rsa.PublicKey;
    return publica.n?.toString(16) === chave.n.toString(16);
  });
  if (!certificado) {
    throw new Error("Certificado do titular não encontrado no arquivo .pfx");
  }

  const certificadoPem = forge.pki.certificateToPem(certificado);

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem,
    cadeiaPem: certificados
      .filter((cert) => cert !== certificado)
      .map((cert) => forge.pki.certificateToPem(cert)),
    certificadoBase64: certificadoPem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
      .replace(/\s+/g, ""),
    titular: certificado.subject.getField("CN")?.value ?? "",
    validoDe: certificado.validity.notBefore,
    validoAte: certificado.validity.notAfter,
  };
}

export interface ArquivosExportados {
  certificado: string;
  chave: string;
  cadeia?: string;
  bundle: string;
}

/**
 * Grava o par extraído do .pfx em arquivos PEM — útil para testes com
 * `curl --cert cert.pem --key key.pem` ou `openssl`.
 * A chave sai sem senha: mantenha o diretório fora do controle de versão.
 */
export function exportarPem(
  certificado: Certificado,
  diretorio: string,
): ArquivosExportados {
  const arquivos: ArquivosExportados = {
    certificado: join(diretorio, "cert.pem"),
    chave: join(diretorio, "key.pem"),
    bundle: join(diretorio, "bundle.pem"),
  };

  writeFileSync(arquivos.certificado, certificado.certificadoPem, { mode: 0o600 });
  writeFileSync(arquivos.chave, certificado.chavePrivadaPem, { mode: 0o600 });
  writeFileSync(
    arquivos.bundle,
    [certificado.certificadoPem, ...certificado.cadeiaPem].join(""),
    { mode: 0o600 },
  );

  if (certificado.cadeiaPem.length > 0) {
    arquivos.cadeia = join(diretorio, "chain.pem");
    writeFileSync(arquivos.cadeia, certificado.cadeiaPem.join(""), { mode: 0o600 });
  }

  return arquivos;
}

function primeiraChave(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.rsa.PrivateKey | null {
  for (const tipo of [OID_CHAVE_CIFRADA, OID_CHAVE]) {
    const bag = p12.getBags({ bagType: tipo })[tipo]?.[0];
    if (bag?.key) return bag.key as forge.pki.rsa.PrivateKey;
  }
  return null;
}
