/**
 * Erros da biblioteca.
 *
 * Todo erro lançado por aqui é um `NfseError`, com um `code` estável para o
 * código de quem integra decidir o que fazer — sem depender do texto, que
 * pode mudar. Três perguntas têm resposta em todo erro:
 *
 * - **de onde veio** — `provider` e `operation`;
 * - **vale repetir?** — `retryable`: só quando a falha é passageira (rede,
 *   serviço fora do ar, limite de requisições);
 * - **a escrita aconteceu?** — `outcomeUnknown`: a requisição de emissão ou
 *   cancelamento saiu, mas a resposta não voltou. Repetir só é seguro com o
 *   mesmo número de RPS/DPS, que o serviço reconhece.
 */
export type NfseErrorCode =
  /** Configuração ausente ou inválida (`.env`, overrides) */
  | "CONFIG"
  /** Certificado ilegível, senha errada, vencido ou recusado pelo servidor */
  | "CERTIFICATE"
  /** Entrada inválida, recusada antes de qualquer envio */
  | "VALIDATION"
  /** Recurso que este provedor ainda não oferece */
  | "NOT_SUPPORTED"
  /** O serviço recusou: regra de negócio, schema, permissão */
  | "REJECTED"
  /** O serviço não encontrou o que foi pedido */
  | "NOT_FOUND"
  /** Credencial recusada (login do portal, certificado sem acesso) */
  | "AUTHENTICATION"
  /** Serviço fora do ar ou limitando requisições — passageiro */
  | "UNAVAILABLE"
  /** Falha de rede ou tempo esgotado — passageiro */
  | "TRANSPORT"
  /** Resposta que não segue o formato documentado */
  | "UNEXPECTED_RESPONSE";

export type NfseProvider = "giss" | "portal" | "nacional" | "brasilapi";

export interface NfseErrorOptions {
  code: NfseErrorCode;
  provider?: NfseProvider;
  operation?: string;
  retryable?: boolean;
  outcomeUnknown?: boolean;
  /** Dados para diagnóstico ou para repetir com segurança (ex.: `dpsId`) */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class NfseError extends Error {
  readonly code: NfseErrorCode;
  readonly provider?: NfseProvider;
  readonly operation?: string;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly details: Record<string, unknown>;

  constructor(message: string, options: NfseErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "NfseError";
    this.code = options.code;
    this.provider = options.provider;
    this.operation = options.operation;
    this.retryable = options.retryable ?? false;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.details = options.details ?? {};
  }
}

/** Mensagem de retorno do serviço (`ListaMensagemRetorno`, `erros` do nacional). */
export interface ServiceMessage {
  code: string;
  message: string;
  correction?: string;
}

export class ConfigError extends NfseError {
  constructor(message: string, options: Partial<NfseErrorOptions> = {}) {
    super(message, { ...options, code: "CONFIG" });
    this.name = "ConfigError";
  }
}

export class CertificateError extends NfseError {
  constructor(message: string, options: Partial<NfseErrorOptions> = {}) {
    super(message, { ...options, code: "CERTIFICATE" });
    this.name = "CertificateError";
  }
}

export class ValidationError extends NfseError {
  constructor(message: string, options: Partial<NfseErrorOptions> = {}) {
    super(message, { ...options, code: "VALIDATION" });
    this.name = "ValidationError";
  }
}

export class NotSupportedError extends NfseError {
  constructor(message: string, options: Partial<NfseErrorOptions> = {}) {
    super(message, { ...options, code: "NOT_SUPPORTED" });
    this.name = "NotSupportedError";
  }
}

/** Falha de rede: conexão recusada ou derrubada, DNS, tempo esgotado. */
export class TransportError extends NfseError {
  constructor(message: string, options: Partial<NfseErrorOptions> = {}) {
    super(message, { retryable: true, ...options, code: "TRANSPORT" });
    this.name = "TransportError";
  }
}

/** Erro de negócio devolvido pelo Web Service SOAP do GissOnline. */
export class GissError extends NfseError {
  readonly messages: ServiceMessage[];
  readonly xml: string;
  declare readonly operation: string;

  constructor(operation: string, messages: ServiceMessage[], xml: string) {
    super(`${operation}: ${messages.map((m) => `[${m.code}] ${m.message}`).join(" | ")}`, {
      code: "REJECTED",
      provider: "giss",
      operation,
    });
    this.name = "GissError";
    this.messages = messages;
    this.xml = xml;
  }
}

/** Falha no envelope SOAP — anterior à camada de negócio. */
export class SoapFaultError extends NfseError {
  declare readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`SOAP Fault em ${operation}: ${detail}`, {
      code: "UNEXPECTED_RESPONSE",
      provider: "giss",
      operation,
    });
    this.name = "SoapFaultError";
  }
}

/**
 * Código e repetição a partir do status HTTP. 408, 429 e 5xx são passageiros;
 * o resto depende de mudar o pedido, então repetir igual não adianta.
 */
export function classifyHttpStatus(status: number): {
  code: NfseErrorCode;
  retryable: boolean;
} {
  if (status === 401 || status === 403) return { code: "AUTHENTICATION", retryable: false };
  if (status === 404) return { code: "NOT_FOUND", retryable: false };
  if (status === 408 || status === 429 || status >= 500) {
    return { code: "UNAVAILABLE", retryable: true };
  }
  if (status >= 200 && status < 300) return { code: "UNEXPECTED_RESPONSE", retryable: false };
  return { code: "REJECTED", retryable: false };
}

/** Erro HTTP da API REST do portal. */
export class PortalError extends NfseError {
  readonly status: number;
  readonly body: unknown;

  constructor(route: string, status: number, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "mensagem" in body
        ? String((body as { mensagem: unknown }).mensagem)
        : JSON.stringify(body).slice(0, 300);
    super(`${route} → HTTP ${status}: ${detail}`, {
      ...classifyHttpStatus(status),
      provider: "portal",
      operation: route,
    });
    this.name = "PortalError";
    this.status = status;
    this.body = body;
  }
}

/** Erro devolvido pela API do Sistema Nacional NFS-e (SEFIN/ADN). */
export class NationalError extends NfseError {
  readonly status: number;
  readonly messages: ServiceMessage[];
  readonly body: unknown;

  constructor(
    route: string,
    status: number,
    messages: ServiceMessage[],
    body: unknown,
    options: Partial<NfseErrorOptions> = {},
  ) {
    const detail = messages.length
      ? messages.map((m) => `[${m.code}] ${m.message}`).join(" | ")
      : typeof body === "string"
        ? body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
        : JSON.stringify(body).slice(0, 300);
    super(`${route} → HTTP ${status}: ${detail}`, {
      ...classifyHttpStatus(status),
      provider: "nacional",
      operation: route,
      ...options,
    });
    this.name = "NationalError";
    this.status = status;
    this.messages = messages;
    this.body = body;
  }
}
