/** Mensagem de retorno do Web Service (`ListaMensagemRetorno`). */
export interface ServiceMessage {
  code: string;
  message: string;
  correction?: string;
}

/** Erro de negócio devolvido pelo Web Service SOAP. */
export class GissError extends Error {
  readonly operation: string;
  readonly messages: ServiceMessage[];
  readonly xml: string;

  constructor(operation: string, messages: ServiceMessage[], xml: string) {
    super(
      `${operation}: ${messages.map((m) => `[${m.code}] ${m.message}`).join(" | ")}`,
    );
    this.name = "GissError";
    this.operation = operation;
    this.messages = messages;
    this.xml = xml;
  }
}

/** Falha no envelope SOAP — anterior à camada de negócio. */
export class SoapFaultError extends Error {
  readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`SOAP Fault em ${operation}: ${detail}`);
    this.name = "SoapFaultError";
    this.operation = operation;
  }
}

/** Erro HTTP da API REST do portal. */
export class PortalError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(route: string, status: number, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "mensagem" in body
        ? String((body as { mensagem: unknown }).mensagem)
        : JSON.stringify(body).slice(0, 300);
    super(`${route} → HTTP ${status}: ${detail}`);
    this.name = "PortalError";
    this.status = status;
    this.body = body;
  }
}
