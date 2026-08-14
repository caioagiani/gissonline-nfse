import { GissError } from "../domain/errors.ts";
import {
  cancellationTarget,
  elementSignature,
  noSignature,
  replacementSignature,
  rpsBatchSignature,
  rpsTarget,
  type SignaturePolicy,
  type XmlSigner,
} from "../domain/signature-policy.ts";
import type {
  CancellationRequest,
  DateRange,
  PartyIdentification,
  Rps,
  RpsBatch,
} from "../domain/types.ts";
import type { Certificate } from "../infra/certificate.ts";
import {
  callSoap,
  type NfseOperation,
  type SoapService,
} from "../infra/soap-client.ts";
import * as messages from "../messages/provided-services.ts";
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

export interface NfseServiceOptions {
  host: string;
  certificate: Certificate;
  signer: XmlSigner;
  provider: PartyIdentification;
  cityCode: string | number;
  version: string;
  debug?: boolean;
}

interface PeriodFilter {
  nfseNumber?: number | string;
  issuePeriod?: DateRange;
  competencePeriod?: DateRange;
}

/** Operações do Web Service `nfse` — emissão e consulta de serviços prestados. */
export class NfseService {
  readonly #options: NfseServiceOptions;

  constructor(options: NfseServiceOptions) {
    this.#options = options;
  }

  private get provider(): PartyIdentification {
    return this.#options.provider;
  }

  // ------------------------------------------------------------------ emissão

  /** Emite uma NFS-e diretamente, sem passar por lote. Processamento síncrono. */
  async issueNfse(rps: Rps): Promise<QueryResult> {
    const xml = await this.execute(
      "GerarNfse",
      this.buildIssueRequest(rps),
      elementSignature(rpsTarget(messages.rpsId(rps)), "GerarNfse (RPS)"),
    );
    return parseQueryResult(xml);
  }

  /**
   * Monta e assina o XML de emissão sem enviá-lo — para conferência e para
   * validar contra os XSD antes de gerar uma nota de verdade.
   */
  previewIssueNfse(rps: Rps): string {
    return elementSignature(rpsTarget(messages.rpsId(rps))).apply(
      this.buildIssueRequest(rps),
      this.#options.signer,
    );
  }

  /** Envia um lote de até 50 RPS. Retorna protocolo; o resultado sai em `queryRpsBatch`. */
  async sendRpsBatch(batch: RpsBatch): Promise<ProtocolResult> {
    this.assertBatchSize(batch);
    const xml = await this.execute(
      "RecepcionarLoteRps",
      messages.sendRpsBatchRequest(batch, this.provider, this.#options.version),
      this.batchPolicy(batch),
    );
    return parseProtocolResult(xml);
  }

  /** Envia um lote de até 50 RPS e devolve as NFS-e na mesma conexão. */
  async sendRpsBatchSync(batch: RpsBatch): Promise<BatchResult> {
    this.assertBatchSize(batch);
    const xml = await this.execute(
      "RecepcionarLoteRpsSincrono",
      messages.sendRpsBatchSyncRequest(batch, this.provider, this.#options.version),
      this.batchPolicy(batch),
    );
    return parseBatchResult(xml);
  }

  /** Cancela uma NFS-e pelo número, informando o motivo. */
  async cancelNfse(request: CancellationRequest): Promise<CancellationResult> {
    const xml = await this.execute(
      "CancelarNfse",
      messages.cancelNfseRequest(
        request,
        this.provider,
        this.#options.cityCode,
        this.#options.version,
      ),
      elementSignature(
        cancellationTarget(messages.cancellationId(request)),
        "CancelarNfse (Pedido)",
      ),
    );
    return parseCancellationResult(xml);
  }

  /** Cancela uma NFS-e e emite outra em substituição, numa única operação. */
  async replaceNfse(
    request: CancellationRequest,
    rps: Rps,
  ): Promise<QueryResult> {
    const xml = await this.execute(
      "SubstituirNfse",
      messages.replaceNfseRequest(
        request,
        rps,
        this.provider,
        this.#options.cityCode,
        this.#options.version,
      ),
      replacementSignature(
        messages.rpsId(rps),
        messages.cancellationId(request),
        messages.replacementId(request),
      ),
    );
    return parseQueryResult(xml);
  }

  // ----------------------------------------------------------------- consultas

  /** Consulta o resultado do processamento de um lote de RPS pelo protocolo. */
  async queryRpsBatch(
    protocol: string,
    provider = this.provider,
  ): Promise<BatchResult> {
    const xml = await this.execute(
      "ConsultarLoteRps",
      messages.queryRpsBatchRequest({
        provider,
        protocol,
        version: this.#options.version,
      }),
    );
    return parseBatchResult(xml);
  }

  /** Consulta NFS-e emitidas dentro de uma faixa de numeração (até 50 por página). */
  async queryNfseRange(args: {
    firstNumber: number | string;
    lastNumber: number | string;
    page?: number;
    provider?: PartyIdentification;
  }): Promise<QueryResult> {
    const xml = await this.execute(
      "ConsultarNfsePorFaixa",
      messages.queryNfseRangeRequest({
        ...args,
        provider: args.provider ?? this.provider,
        version: this.#options.version,
      }),
    );
    return parseQueryResult(xml);
  }

  /** Consulta a NFS-e gerada a partir de um RPS (número + série + tipo). */
  async queryNfseByRps(args: {
    number: number | string;
    series: string;
    type?: 1 | 2 | 3;
    provider?: PartyIdentification;
  }): Promise<QueryResult> {
    const xml = await this.execute(
      "ConsultarNfsePorRps",
      messages.queryNfseByRpsRequest({
        ...args,
        provider: args.provider ?? this.provider,
        version: this.#options.version,
      }),
    );
    return parseQueryResult(xml);
  }

  /**
   * Consulta NFS-e emitidas pelo prestador por período de emissão, período de
   * competência ou número de nota. Retorna até 50 notas por página.
   */
  async queryProvidedServices(
    args: PeriodFilter & {
      taker?: PartyIdentification;
      intermediary?: PartyIdentification;
      page?: number;
      provider?: PartyIdentification;
    },
  ): Promise<QueryResult> {
    const xml = await this.execute(
      "ConsultarNfseServicoPrestado",
      messages.queryProvidedServicesRequest({
        ...args,
        provider: args.provider ?? this.provider,
        version: this.#options.version,
      }),
    );
    return parseQueryResult(xml);
  }

  /** Consulta NFS-e em que a empresa aparece como tomadora (notas de fornecedores). */
  async queryTakenServices(
    args: PeriodFilter & {
      provider?: PartyIdentification;
      taker?: PartyIdentification;
      intermediary?: PartyIdentification;
      page?: number;
      requester?: PartyIdentification;
    },
  ): Promise<QueryResult> {
    const xml = await this.execute(
      "ConsultarNfseServicoTomado",
      messages.queryTakenServicesRequest({
        ...args,
        requester: args.requester ?? this.provider,
        version: this.#options.version,
      }),
      // O XSD desta operação não declara `Signature`: assinar devolve E160.
      noSignature,
    );
    return parseQueryResult(xml);
  }

  // ---------------------------------------------------------------- infraestrutura

  private buildIssueRequest(rps: Rps): string {
    return messages.generateNfseRequest(rps, this.provider, this.#options.version);
  }

  private batchPolicy(batch: RpsBatch): SignaturePolicy {
    return rpsBatchSignature(
      batch.rps.map((rps) => messages.rpsId(rps)),
      messages.batchId(batch),
    );
  }

  private assertBatchSize(batch: RpsBatch): void {
    if (batch.rps.length === 0) throw new Error("Lote sem RPS");
    if (batch.rps.length > 50) {
      throw new Error(`Lote com ${batch.rps.length} RPS — o limite é 50 por lote`);
    }
  }

  /** Aplica a política de assinatura, envia e valida a resposta. */
  private async execute(
    operation: NfseOperation,
    data: string,
    policy: SignaturePolicy = { name: "raiz", apply: (xml, s) => s.sign(xml) },
  ): Promise<string> {
    const { host, certificate, signer, version, debug } = this.#options;
    const signed = policy.apply(data, signer);

    if (debug) {
      console.error(`\n--- ${operation} (${policy.name}) envio ---\n${signed}`);
    }

    const response = await callSoap(operation, signed, {
      host,
      service: "nfse" satisfies SoapService,
      certificate,
      header: messages.buildHeader(version),
    });

    if (debug) console.error(`\n--- ${operation} retorno ---\n${response.xml}`);

    const errors = parseErrors(response.xml);
    if (errors.length > 0) throw new GissError(operation, errors, response.xml);

    return response.xml;
  }
}
