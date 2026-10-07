import type { Environment } from "../../config/index.ts";
import { NationalError, type ServiceMessage } from "../../domain/errors.ts";
import type { XmlSigner } from "../../domain/signature-policy.ts";
import type { Rps } from "../../domain/types.ts";
import type { Certificate } from "../../infra/certificate.ts";
import {
  callNational,
  packXml,
  parseJson,
  unpackXml,
  type NationalResponse,
} from "./national-client.ts";
import {
  buildCancellationEvent,
  buildDps,
  dpsId,
  parseNationalNfse,
  type DpsContext,
  type NationalCancellationReason,
  type NationalEnvironment,
  type NationalNfse,
  type SimplesOption,
} from "./messages.ts";

/**
 * Hosts do Sistema Nacional NFS-e. A SEFIN emite e registra eventos; o ADN
 * (Ambiente de Dados Nacional) distribui documentos, gera o DANFSe e publica
 * a parametrização dos municípios. "Produção restrita" é o ambiente de testes.
 */
export const NATIONAL_HOSTS = {
  producao: {
    sefin: "https://sefin.nfse.gov.br/SefinNacional",
    adn: "https://adn.nfse.gov.br",
  },
  homologacao: {
    sefin: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
    adn: "https://adn.producaorestrita.nfse.gov.br",
  },
} as const;

/** Adesão do município ao Sistema Nacional, como o ADN a publica. */
export interface MunicipalAgreement {
  /** Compartilha as notas do sistema próprio com o ambiente nacional */
  sharesWithNational: boolean;
  /** Aceita emissão pelos emissores públicos (web e API). Sem isso: E0039. */
  usesNationalIssuer: boolean;
  raw: Record<string, unknown>;
}

export interface NationalIssueOptions {
  series: string | number;
  number: string | number;
  simplesOption: SimplesOption;
  simplesApportionment?: 1 | 2 | 3;
}

export interface NationalIssueOutcome {
  status: "issued" | "already-issued";
  dpsId: string;
  nfse: NationalNfse;
  alerts: ServiceMessage[];
}

/** Documento distribuído pelo ADN — notas e eventos em que o CNPJ aparece. */
export interface DistributedDocument {
  nsu: number;
  accessKey: string;
  type: string;
  xml: string;
}

export interface NationalServiceOptions {
  certificate: Certificate;
  /** Assinador SHA-256 — ver `createXmlSigner(certificate, "sha256")` */
  signer: XmlSigner;
  environment: Environment;
  cnpj: string;
  /** Município do emitente (IBGE, 7 dígitos) */
  cityCode: string;
  debug?: boolean;
  /** Substitui o transporte HTTPS — para testes, ou para passar por um proxy */
  transport?: typeof callNational;
}

export class NationalService {
  readonly hosts: (typeof NATIONAL_HOSTS)[Environment];
  private readonly options: NationalServiceOptions;

  constructor(options: NationalServiceOptions) {
    this.options = options;
    this.hosts = NATIONAL_HOSTS[options.environment];
  }

  get environmentCode(): NationalEnvironment {
    return this.options.environment === "producao" ? 1 : 2;
  }

  /** Parâmetros do convênio do município. Pública na prática, mas exige mTLS. */
  async agreement(cityCode = this.options.cityCode): Promise<MunicipalAgreement> {
    const body = await this.json<{ parametrosConvenio?: Record<string, unknown> }>(
      `${this.hosts.adn}/parametrizacao/${cityCode}/convenio`,
    );
    const raw = body.parametrosConvenio ?? {};
    return {
      sharesWithNational: raw["aderenteAmbienteNacional"] === 1,
      usesNationalIssuer: raw["aderenteEmissorNacional"] === 1,
      raw,
    };
  }

  /** DPS montada e assinada, sem enviar — para conferência e validação. */
  previewDps(rps: Rps, options: NationalIssueOptions): string {
    return this.signDps(rps, options).xml;
  }

  /**
   * Emite a NFS-e a partir da DPS. Idempotente pelo id da DPS: se a mesma
   * série e número já viraram nota, devolve essa nota em vez de reenviar.
   */
  async issue(rps: Rps, options: NationalIssueOptions): Promise<NationalIssueOutcome> {
    const { id, xml } = this.signDps(rps, options);

    const existing = await this.findByDps(id);
    if (existing) {
      return { status: "already-issued", dpsId: id, nfse: existing, alerts: [] };
    }

    const body = await this.json<{ nfseXmlGZipB64?: string; alertas?: unknown }>(
      `${this.hosts.sefin}/nfse`,
      { method: "POST", json: { dpsXmlGZipB64: packXml(xml) } },
    );
    if (!body.nfseXmlGZipB64) {
      throw new NationalError("/nfse", 200, [], body);
    }

    return {
      status: "issued",
      dpsId: id,
      nfse: parseNationalNfse(unpackXml(body.nfseXmlGZipB64)),
      alerts: messagesOf(body.alertas),
    };
  }

  /** Nota gerada a partir de uma DPS, ou `null` se a DPS não virou nota. */
  async findByDps(id: string): Promise<NationalNfse | null> {
    const url = `${this.hosts.sefin}/dps/${id}`;
    const response = await this.call(url);
    if (response.status === 404) return null;
    const body = this.unwrap<{ chaveAcesso?: string }>(url, response);
    return body.chaveAcesso ? this.get(body.chaveAcesso) : null;
  }

  async get(accessKey: string): Promise<NationalNfse> {
    const body = await this.json<{ nfseXmlGZipB64?: string }>(
      `${this.hosts.sefin}/nfse/${accessKey}`,
    );
    if (!body.nfseXmlGZipB64) throw new NationalError(`/nfse/${accessKey}`, 200, [], body);
    return parseNationalNfse(unpackXml(body.nfseXmlGZipB64));
  }

  /** DANFSe — a representação em PDF da nota, gerada pelo ADN. */
  async pdf(accessKey: string): Promise<Buffer> {
    const url = `${this.hosts.adn}/danfse/${accessKey}`;
    const response = await this.call(url);
    if (response.status !== 200 || !response.contentType.includes("pdf")) {
      throw this.failure(url, response);
    }
    return response.body;
  }

  /**
   * Cancela pelo evento 101101. Devolve o XML do evento registrado.
   * Fora do prazo do município, a SEFIN recusa e pede análise fiscal (evento 101103).
   */
  async cancel(
    accessKey: string,
    reason: NationalCancellationReason,
    justification: string,
  ): Promise<string> {
    const event = buildCancellationEvent({
      environment: this.environmentCode,
      cnpj: this.options.cnpj,
      accessKey,
      reason,
      justification,
    });
    const signed = this.options.signer.sign(event, {
      referenceXPath: "//*[local-name(.)='infPedReg']",
      id: `PRE${accessKey}101101`,
      targetXPath: "/*",
    });
    this.log("pedRegEvento", signed);

    const body = await this.json<{ eventoXmlGZipB64?: string }>(
      `${this.hosts.sefin}/nfse/${accessKey}/eventos`,
      { method: "POST", json: { pedidoRegistroEventoXmlGZipB64: packXml(signed) } },
    );
    return body.eventoXmlGZipB64 ? unpackXml(body.eventoXmlGZipB64) : "";
  }

  /**
   * Documentos em que o CNPJ do certificado aparece — emitidos e recebidos,
   * inclusive os que o município compartilha a partir do sistema próprio.
   * Lê a partir do NSU informado, em lotes de até 50.
   */
  async distribution(fromNsu = 0): Promise<DistributedDocument[]> {
    const url = `${this.hosts.adn}/contribuintes/DFe/${fromNsu}?lote=true`;
    const response = await this.call(url);
    if (response.status === 404) return [];
    const body = this.unwrap<{
      LoteDFe?: { NSU: number; ChaveAcesso: string; TipoDocumento: string; ArquivoXml: string }[];
    }>(url, response);
    return (body.LoteDFe ?? []).map((d) => ({
      nsu: d.NSU,
      accessKey: d.ChaveAcesso,
      type: d.TipoDocumento,
      xml: unpackXml(d.ArquivoXml),
    }));
  }

  private signDps(rps: Rps, options: NationalIssueOptions): { id: string; xml: string } {
    const context: DpsContext = {
      environment: this.environmentCode,
      cnpj: this.options.cnpj,
      cityCode: this.options.cityCode,
      ...options,
    };
    const id = dpsId(context);
    const xml = this.options.signer.sign(buildDps(rps, context), {
      referenceXPath: "//*[local-name(.)='infDPS']",
      id,
      targetXPath: "/*",
    });
    this.log("DPS", xml);
    return { id, xml };
  }

  private call(url: string, init: { method?: "GET" | "POST"; json?: unknown } = {}) {
    const transport = this.options.transport ?? callNational;
    return transport(url, { certificate: this.options.certificate, ...init });
  }

  private async json<T>(url: string, init: { method?: "GET" | "POST"; json?: unknown } = {}) {
    return this.unwrap<T>(url, await this.call(url, init));
  }

  private unwrap<T>(url: string, response: NationalResponse): T {
    if (response.status < 200 || response.status >= 300) throw this.failure(url, response);
    const body = parseJson<T>(response);
    if (body === null) throw this.failure(url, response);
    this.log(`← ${url}`, JSON.stringify(body).slice(0, 2000));
    return body;
  }

  private failure(url: string, response: NationalResponse): NationalError {
    const body = parseJson<Record<string, unknown>>(response) ?? response.body.toString("utf8");
    const messages =
      typeof body === "object" ? messagesOf(body["erros"] ?? body["erro"]) : [];
    return new NationalError(new URL(url).pathname, response.status, messages, body);
  }

  private log(label: string, content: string): void {
    if (this.options.debug) console.error(`\n--- ${label} ---\n${content}`);
  }
}

/** A API alterna `Codigo`/`codigo` e lista/objeto único conforme a rota. */
function messagesOf(value: unknown): ServiceMessage[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item: Record<string, unknown>) => ({
    code: String(item["Codigo"] ?? item["codigo"] ?? ""),
    message: String(item["Descricao"] ?? item["descricao"] ?? ""),
    correction: (item["Complemento"] ?? item["complemento"]) as string | undefined,
  }));
}
