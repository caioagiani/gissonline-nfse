import { loadConfig, type GissConfig } from "../config/index.ts";
import type { PartyIdentification } from "../domain/types.ts";
import {
  loadCertificate,
  type Certificate,
  type CertificateInput,
} from "../infra/certificate.ts";
import { createXmlSigner } from "../infra/xml-signer.ts";
import type { QueryResult } from "../messages/parser.ts";
import { NfscService } from "./nfsc-service.ts";
import { NfseService } from "./nfse-service.ts";

export interface GissClientOptions extends Partial<GissConfig> {
  /**
   * Certificado a usar, no lugar de `certificatePath`: o caminho do .pfx, o
   * arquivo em memória, ou um `Certificate` já carregado. A última forma evita
   * reabrir o PKCS#12 a cada instância, que é a parte cara.
   */
  certificate?: CertificateInput;
  /** Loga na saída de erro os XMLs enviados e recebidos */
  debug?: boolean;
}

/**
 * Fachada sobre os dois Web Services SOAP.
 *
 * Carrega o certificado uma vez, monta o assinador e entrega os serviços
 * `nfse` (serviços prestados) e `nfsc` (serviços tomados) já configurados.
 * O cadastro de participantes não passa por aqui — vive na API REST do portal,
 * em `PortalService`.
 */
/** Marca a config quando o certificado não veio de um arquivo. */
const MEMORY_CERTIFICATE = "<in-memory>";

export class GissClient {
  readonly config: GissConfig;
  readonly certificate: Certificate;
  readonly nfse: NfseService;
  readonly nfsc: NfscService;

  constructor(options: GissClientOptions = {}) {
    const { debug = false, certificate, ...overrides } = options;

    // `CERT_PATH` e `CERT_PASSWORD` só existem para abrir o arquivo: quando o
    // certificado chega pronto, nada disso é necessário e exigir as variáveis
    // impediria o uso sem `.env`. Um .pfx em memória ainda precisa da senha.
    const fromMemory = certificate !== undefined && typeof certificate !== "string";
    const parsed = fromMemory && !Buffer.isBuffer(certificate);
    this.config = loadConfig({
      ...(fromMemory ? { certificatePath: MEMORY_CERTIFICATE } : {}),
      ...(parsed ? { certificatePassword: "" } : {}),
      ...overrides,
    });
    this.certificate = loadCertificate(
      certificate ?? this.config.certificatePath,
      this.config.certificatePassword,
    );

    const signer = createXmlSigner(this.certificate);
    const shared = {
      host: this.config.host,
      certificate: this.certificate,
      signer,
      cityCode: this.config.cityCode,
      debug,
    };

    this.nfse = new NfseService({
      ...shared,
      provider: this.provider,
      version: this.config.version,
    });
    this.nfsc = new NfscService({ ...shared, taker: this.provider });
  }

  /** Identificação do prestador configurado no `.env`. */
  get provider(): PartyIdentification {
    return {
      cnpj: this.config.cnpj,
      municipalRegistration: this.config.municipalRegistration,
    };
  }

  /**
   * Percorre todas as páginas de uma consulta paginada até esgotar os
   * resultados (o serviço devolve no máximo 50 notas por página).
   */
  async *paginate(
    query: (page: number) => Promise<QueryResult>,
    pageLimit = 200,
  ): AsyncGenerator<QueryResult> {
    for (let page = 1; page <= pageLimit; page++) {
      const result = await query(page);
      yield result;
      if (result.invoices.length < 50) return;
    }
  }
}
