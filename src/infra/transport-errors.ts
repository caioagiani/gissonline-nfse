import {
  CertificateError,
  NfseError,
  TransportError,
  type NfseProvider,
} from "../domain/errors.ts";
import type { Certificate } from "./certificate.ts";

/**
 * Traduz a falha crua do Node (`ECONNRESET`, alerta TLS, timeout) em um
 * `NfseError` que diz o que aconteceu e se vale repetir.
 */
export interface TransportContext {
  provider: NfseProvider;
  operation: string;
  /**
   * A requisição altera estado no serviço (emitir, cancelar). Com isso, uma
   * falha depois do envio deixa o resultado incerto — e o erro diz isso.
   */
  write?: boolean;
}

/** Erro de tempo esgotado, com o `code` que o resto da classificação entende. */
export function timeoutError(ms: number): Error {
  return Object.assign(new Error(`tempo esgotado após ${ms}ms`), { code: "ETIMEDOUT" });
}

/** O servidor recusou o certificado do cliente no handshake. */
const CLIENT_CERTIFICATE_REJECTED = [
  "ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE",
  "ERR_SSL_TLSV1_ALERT_BAD_CERTIFICATE",
  "ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED",
  "ERR_SSL_TLSV1_ALERT_CERTIFICATE_EXPIRED",
  "ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED",
  "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
  "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
  "ERR_SSL_TLSV1_ALERT_ACCESS_DENIED",
];

/** O certificado do servidor não foi aceito por este cliente. */
const SERVER_CERTIFICATE_UNTRUSTED = [
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
];

/** Falhas de rede em que tentar de novo costuma resolver. */
const TRANSIENT = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
];

const UNCERTAIN_HINT: Record<NfseProvider, string> = {
  giss: "A requisição pode ter chegado: repita com o mesmo número de RPS, que não gera nota duplicada.",
  nacional: "A requisição pode ter chegado: repita com a mesma série e número de DPS, que não gera nota duplicada.",
  portal: "A requisição pode ter chegado: confira o resultado no portal antes de repetir.",
  brasilapi: "",
};

/** `fetch` embrulha a causa real em `TypeError: fetch failed`. */
function errorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function classifyTransportError(error: unknown, context: TransportContext): NfseError {
  if (error instanceof NfseError) return error;

  const code = errorCode(error);
  const where = `${context.operation} (${context.provider})`;
  const base = {
    provider: context.provider,
    operation: context.operation,
    cause: error,
    details: code ? { errno: code } : {},
  };

  if (code && CLIENT_CERTIFICATE_REJECTED.includes(code)) {
    return new CertificateError(
      `${where}: o servidor recusou o certificado A1 no handshake (${code}). ` +
        "Confira validade, revogação e se é o certificado da empresa configurada.",
      base,
    );
  }

  if (code && SERVER_CERTIFICATE_UNTRUSTED.includes(code)) {
    return new TransportError(
      `${where}: o certificado do servidor não é confiável para este Node (${code}).`,
      { ...base, retryable: false },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const transient = code !== undefined && TRANSIENT.includes(code);
  const uncertain = Boolean(context.write);

  return new TransportError(
    `${where}: falha de rede — ${message}` +
      (uncertain ? `. ${UNCERTAIN_HINT[context.provider]}` : ""),
    { ...base, retryable: transient || code === undefined, outcomeUnknown: uncertain },
  );
}

/**
 * Recusa o envio com certificado fora da validade. O servidor recusaria de
 * qualquer jeito, mas com um alerta TLS genérico; aqui a mensagem diz a data.
 */
export function assertCertificateUsable(
  certificate: Certificate,
  context: Omit<TransportContext, "write">,
  now = new Date(),
): void {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  if (certificate.validTo < now) {
    throw new CertificateError(
      `Certificado ${certificate.subject} vencido em ${day(certificate.validTo)}`,
      { ...context, details: { validTo: certificate.validTo } },
    );
  }
  if (certificate.validFrom > now) {
    throw new CertificateError(
      `Certificado ${certificate.subject} só vale a partir de ${day(certificate.validFrom)}`,
      { ...context, details: { validFrom: certificate.validFrom } },
    );
  }
}
