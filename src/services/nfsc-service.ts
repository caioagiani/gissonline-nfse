import { GissError } from "../domain/errors.ts";
import { rootSignature, type XmlSigner } from "../domain/signature-policy.ts";
import type {
  PartyIdentification,
  PurchasedService,
  PurchasedServiceBatch,
} from "../domain/types.ts";
import type { Certificate } from "../infra/certificate.ts";
import { callSoap, type NfscOperation } from "../infra/soap-client.ts";
import {
  parseBatchResult,
  parseCancellationResult,
  parseErrors,
  parseProtocolResult,
  parseQueryResult,
  type BatchResult,
  type CancellationResult,
  type ProtocolResult,
  type QueryResult,
} from "../messages/parser.ts";
import * as messages from "../messages/taken-services.ts";

export interface NfscServiceOptions {
  host: string;
  certificate: Certificate;
  signer: XmlSigner;
  taker: PartyIdentification;
  cityCode: string | number;
  debug?: boolean;
}

/**
 * Operações do Web Service `nfsc` — declaração de serviços tomados.
 *
 * Ao contrário do `nfse`, este serviço não recebe cabeçalho de versão e todas
 * as operações assinam a raiz do documento.
 */
export class NfscService {
  readonly #options: NfscServiceOptions;

  constructor(options: NfscServiceOptions) {
    this.#options = options;
  }

  private get taker(): PartyIdentification {
    return this.#options.taker;
  }

  /** Declara uma nota de serviço tomado (nota de fornecedor), uma a uma. */
  async issuePurchasedService(
    invoice: PurchasedService,
  ): Promise<ProtocolResult> {
    const xml = await this.execute(
      "EmitirNotaServicoComprado",
      messages.issuePurchasedServiceRequest(invoice, this.taker),
    );
    return parseProtocolResult(xml);
  }

  /** Declara um lote de notas de serviço tomado (até 50 por lote). */
  async sendPurchasedServiceBatch(
    batch: PurchasedServiceBatch,
  ): Promise<ProtocolResult> {
    if (batch.invoices.length === 0) throw new Error("Lote sem notas");
    if (batch.invoices.length > 50) {
      throw new Error(
        `Lote com ${batch.invoices.length} notas — o limite é 50 por lote`,
      );
    }
    const xml = await this.execute(
      "EnviarLoteNotaServicoComprado",
      messages.sendPurchasedServiceBatchRequest(batch, this.taker),
    );
    return parseProtocolResult(xml);
  }

  /** Cancela uma nota de serviço tomado pelo código de verificação. */
  async cancelPurchasedService(args: {
    verificationCode: string;
    cancellationCode: number;
    taker?: PartyIdentification;
    cityCode?: string | number;
  }): Promise<CancellationResult> {
    const xml = await this.execute(
      "CancelarNotaServicoComprado",
      messages.cancelPurchasedServiceRequest({
        verificationCode: args.verificationCode,
        taker: args.taker ?? this.taker,
        cityCode: args.cityCode ?? this.#options.cityCode,
        cancellationCode: args.cancellationCode,
      }),
    );
    return parseCancellationResult(xml);
  }

  /**
   * Consulta notas de serviço tomado por número/série declarados e período.
   * Apesar de o XSD marcar `NumeroDeclarado` e `SerieDeclarada` como opcionais,
   * o serviço responde HTTP 400 quando eles faltam.
   */
  async queryPurchasedByNumber(args: {
    competencePeriod: { from: string; to?: string };
    issuePeriod: { from: string; to?: string };
    declaredNumber: number | string;
    declaredSeries: string;
    taker?: PartyIdentification;
  }): Promise<QueryResult> {
    if (!args.declaredNumber || !args.declaredSeries) {
      throw new Error(
        "ConsultarServicoCompradoPorNumero exige declaredNumber e declaredSeries",
      );
    }
    const xml = await this.execute(
      "ConsultarServicoCompradoPorNumero",
      messages.queryPurchasedByNumberRequest({
        ...args,
        taker: args.taker ?? this.taker,
      }),
    );
    return parseQueryResult(xml);
  }

  /** Consulta as notas declaradas em um lote. */
  async queryPurchasedByBatch(
    protocol: string,
    taker = this.taker,
  ): Promise<QueryResult> {
    const xml = await this.execute(
      "ConsultarServicoCompradoPorLote",
      messages.queryPurchasedByBatchRequest({ taker, protocol }),
    );
    return parseQueryResult(xml);
  }

  /** Consulta a situação de processamento de um protocolo de serviços tomados. */
  async queryPurchasedByProtocol(
    protocol: string,
    taker = this.taker,
  ): Promise<BatchResult> {
    const xml = await this.execute(
      "ConsultarServicoCompradoPorProtocolo",
      messages.queryPurchasedByProtocolRequest({ taker, protocol }),
    );
    return parseBatchResult(xml);
  }

  private async execute(
    operation: NfscOperation,
    data: string,
  ): Promise<string> {
    const { host, certificate, signer, debug } = this.#options;
    const signed = rootSignature.apply(data, signer);

    if (debug) console.error(`\n--- ${operation} envio ---\n${signed}`);

    const response = await callSoap(operation, signed, {
      host,
      service: "nfsc",
      certificate,
    });

    if (debug) console.error(`\n--- ${operation} retorno ---\n${response.xml}`);

    const errors = parseErrors(response.xml);
    if (errors.length > 0) throw new GissError(operation, errors, response.xml);

    return response.xml;
  }
}
