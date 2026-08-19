import { XMLParser } from "fast-xml-parser";
import type { ServiceMessage } from "../domain/errors.ts";

/** Leitura das respostas XML do Web Service, normalizadas para objetos simples. */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  ignoreDeclaration: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export interface Party {
  taxId?: string;
  municipalRegistration?: string;
  legalName?: string;
  email?: string;
  cityCode?: string;
}

/** O RPS que originou uma NFS-e. */
export interface RpsIdentification {
  number: string;
  series: string;
  /** 1 = RPS, 2 = nota fiscal conjugada, 3 = cupom */
  type?: 1 | 2 | 3;
}

export interface Nfse {
  number: string;
  /** Id interno (`InfNfse@Id`), que as rotas de download do portal exigem */
  internalId?: string;
  /**
   * RPS que originou a nota. Ausente nas notas lançadas direto no portal, que
   * não passam por RPS nenhum — só as emitidas pelo Web Service o têm.
   */
  rps?: RpsIdentification;
  verificationCode: string;
  issueDate: string;
  competenceDate?: string;
  serviceAmount?: string;
  netAmount?: string;
  issAmount?: string;
  description?: string;
  provider?: Party;
  taker?: Party;
  /** Estrutura completa do CompNfse, para os campos não normalizados */
  raw: Record<string, unknown>;
}

export interface QueryResult {
  invoices: Nfse[];
  page?: string;
  warnings: ServiceMessage[];
  xml: string;
}

export const BATCH_STATUS: Record<string, string> = {
  "1": "Não recebido",
  "2": "Não processado",
  "3": "Processado com erro",
  "4": "Processado com sucesso",
};

export interface BatchResult extends QueryResult {
  status: string;
  statusLabel: string;
  batchNumber?: string;
  protocol?: string;
  receivedAt?: string;
}

/** Retorno de RecepcionarLoteRps — o processamento é assíncrono. */
export interface ProtocolResult {
  batchNumber?: string;
  receivedAt?: string;
  protocol?: string;
  warnings: ServiceMessage[];
  xml: string;
}

export interface CancellationResult {
  nfseNumber?: string;
  cancelledAt?: string;
  warnings: ServiceMessage[];
  xml: string;
}

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

export function parseQueryResult(xml: string): QueryResult {
  const response = unwrapRoot(parser.parse(xml));
  return {
    invoices: extractInvoices(response),
    page: asText(findAll(response, "Pagina")[0]),
    warnings: extractMessages(response, "MensagemAlertaRetorno"),
    xml,
  };
}

export function parseBatchResult(xml: string): BatchResult {
  const response = unwrapRoot(parser.parse(xml));
  const status = String(asText(findAll(response, "Situacao")[0]) ?? "");
  return {
    ...parseQueryResult(xml),
    status,
    statusLabel: BATCH_STATUS[status] ?? "Desconhecida",
    batchNumber: asText(findAll(response, "NumeroLote")[0]),
    protocol: asText(findAll(response, "Protocolo")[0]),
    receivedAt: asText(findAll(response, "DataRecebimento")[0]),
  };
}

export function parseProtocolResult(xml: string): ProtocolResult {
  const response = unwrapRoot(parser.parse(xml));
  return {
    batchNumber: asText(findAll(response, "NumeroLote")[0]),
    receivedAt: asText(findAll(response, "DataRecebimento")[0]),
    protocol: asText(findAll(response, "Protocolo")[0]),
    warnings: extractMessages(response, "MensagemAlertaRetorno"),
    xml,
  };
}

export function parseCancellationResult(xml: string): CancellationResult {
  const response = unwrapRoot(parser.parse(xml));
  return {
    nfseNumber: asText(findAll(response, "Numero")[0]),
    cancelledAt: asText(findAll(response, "DataHora")[0]),
    warnings: extractMessages(response, "MensagemAlertaRetorno"),
    xml,
  };
}

/** Erros de negócio da resposta (`ListaMensagemRetorno`). */
export function parseErrors(xml: string): ServiceMessage[] {
  return extractMessages(parser.parse(xml), "MensagemRetorno");
}

/** Descarta o elemento raiz nomeado e devolve seu conteúdo. */
function unwrapRoot(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const values = Object.values(value as Record<string, unknown>);
  return values[0] ?? value;
}

const toArray = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") return undefined;
  return String(value);
}

/** Coleta recursivamente todos os valores associados a uma chave. */
function findAll(node: unknown, key: string): unknown[] {
  if (!node || typeof node !== "object") return [];
  const found: unknown[] = [];
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    if (name === key) found.push(...toArray(value));
    else found.push(...findAll(value, key));
  }
  return found;
}

function extractMessages(node: unknown, key: string): ServiceMessage[] {
  return findAll(node, key).map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      code: asText(record["Codigo"]) ?? "",
      message: asText(record["Mensagem"]) ?? "",
      correction: asText(record["Correcao"]),
    };
  });
}

/**
 * O `IdentificacaoRps` fica aninhado em profundidade variável conforme a
 * operação, então é procurado em vez de acessado por caminho fixo.
 */
function extractRps(node: unknown): RpsIdentification | undefined {
  const found = findAll(node, "IdentificacaoRps")[0] as
    | Record<string, unknown>
    | undefined;
  if (!found) return undefined;

  const number = asText(found["Numero"]);
  const series = asText(found["Serie"]);
  if (!number || !series) return undefined;

  // O XML traz o tipo como texto, mas a entrada de `findByRps` o quer como
  // número — converter aqui deixa `findByRps(invoice.rps)` compilar direto.
  const type = Number(asText(found["Tipo"]));
  return {
    number,
    series,
    ...(type === 1 || type === 2 || type === 3 ? { type } : {}),
  };
}

function extractParty(node: unknown): Party {
  const record = (node ?? {}) as Record<string, unknown>;
  const taxId = (findAll(record, "CpfCnpj")[0] ?? {}) as Record<string, unknown>;
  const address = (findAll(record, "Endereco")[0] ?? {}) as Record<string, unknown>;
  return {
    taxId: asText(taxId["Cnpj"]) ?? asText(taxId["Cpf"]),
    municipalRegistration: asText(findAll(record, "InscricaoMunicipal")[0]),
    legalName: asText(findAll(record, "RazaoSocial")[0]),
    email: asText(findAll(record, "Email")[0]),
    cityCode: asText(address["CodigoMunicipio"]),
  };
}

function extractInvoices(node: unknown): Nfse[] {
  return findAll(node, "CompNfse").map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const info = (findAll(record, "InfNfse")[0] ?? {}) as Record<string, unknown>;
    const amounts = (findAll(info, "ValoresNfse")[0] ?? {}) as Record<string, unknown>;
    const service = (findAll(info, "Servico")[0] ?? {}) as Record<string, unknown>;

    return {
      number: asText(info["Numero"]) ?? "",
      internalId: asText(info["@Id"]),
      rps: extractRps(record),
      verificationCode: asText(info["CodigoVerificacao"]) ?? "",
      issueDate: asText(info["DataEmissao"]) ?? "",
      competenceDate: asText(findAll(info, "Competencia")[0]),
      serviceAmount: asText(findAll(service, "ValorServicos")[0]),
      netAmount: asText(amounts["ValorLiquidoNfse"]),
      issAmount: asText(amounts["ValorIss"]),
      description: asText(findAll(service, "Discriminacao")[0]),
      provider: extractParty(findAll(info, "PrestadorServico")[0]),
      taker: extractParty(findAll(info, "TomadorServico")[0]),
      raw: record,
    };
  });
}
