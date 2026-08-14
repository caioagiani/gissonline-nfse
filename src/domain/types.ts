/**
 * Tipos de domínio da NFS-e.
 *
 * Convenção de nomes: identificadores em inglês, siglas e entidades do padrão
 * preservadas (Rps, Nfse, Iss, Cnpj, Cpf). Assim o código continua mapeável
 * linha a linha contra os manuais e os XSD da prefeitura.
 */

/** 1 = sim, 2 = não — o `tsSimNao` dos schemas. */
export type YesNo = 1 | 2;

export interface PartyIdentification {
  cnpj?: string;
  cpf?: string;
  municipalRegistration?: string;
}

export interface Address {
  street: string;
  number: string;
  complement?: string;
  district: string;
  /** Código IBGE do município (7 dígitos) */
  cityCode: string | number;
  state: string;
  zipCode: string;
}

export interface Contact {
  phone?: string;
  email?: string;
}

/** Tomador do serviço — quem recebe a NFS-e. */
export interface ServiceTaker {
  cnpj?: string;
  cpf?: string;
  municipalRegistration?: string;
  /** Número de identificação fiscal, para tomador no exterior */
  nif?: string;
  legalName: string;
  address?: Address;
  contact?: Contact;
}

/** Prestador na declaração de serviços tomados — o fornecedor. */
export interface Supplier {
  cnpj?: string;
  cpf?: string;
  municipalRegistration?: string;
  nif?: string;
  legalName: string;
  tradeName?: string;
  address?: Address;
  contact?: Contact;
  /** 1 a 6 — ver `tsRegimeEspecialTributacao` */
  specialTaxRegime?: number;
  simplesNacionalOptant?: YesNo;
}

export interface Intermediary {
  cnpj?: string;
  cpf?: string;
  municipalRegistration?: string;
  legalName: string;
  cityCode: string | number;
}

/** Grupo PIS/COFINS do `tribFed` (NT SE/CGNFS-e nº 007). */
export interface PisCofins {
  /** Código de Situação Tributária, ex.: "01" tributável, "08" sem incidência */
  cst: string;
  taxableAmount?: number;
  pisRate?: number;
  cofinsRate?: number;
  /** Valor PRÓPRIO do PIS — nunca o retido */
  pisAmount?: number;
  /** Valor PRÓPRIO da COFINS — nunca o retido */
  cofinsAmount?: number;
  /**
   * 0 = nada retido; 3 = PIS/COFINS/CSLL retidos; 4 = PIS/COFINS retidos, CSLL não;
   * 5 = só PIS; 6 = só COFINS; 7 = COFINS/CSLL; 8 = só CSLL; 9 = PIS/CSLL.
   * Os tipos 1 e 2 deixaram de ser recepcionados em 01/08/2026 (NT 007).
   */
  withholdingType?: 0 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Percentuais aproximados de tributos (Lei 12.741/2012). */
export interface ApproximateTaxes {
  federal?: number;
  state?: number;
  municipal?: number;
  /** Percentual único para optantes do Simples Nacional */
  simplesNacional?: number;
  /** Quando não se informa estimativa alguma, envie `indicator: 0` */
  indicator?: 0;
}

/** Grupo IBS/CBS da LC 214/2025. */
export interface IbsCbs {
  /** Finalidade da NFS-e (`finNFSe`) */
  purpose: number;
  /** 0 = não é consumidor final, 1 = consumidor final */
  endConsumer: number;
  /** Código do indicador da operação (`cIndOp`) */
  operationIndicator: string;
  operationType?: number;
  governmentEntityType?: number;
  /** 0 = destinatário no país */
  recipientIndicator: number;
  cst: string;
  taxClassification: string;
  incidenceLocationCode?: string | number;
  reductionRate?: number;
  taxableAmount?: number;
  /** Chaves de NFS-e referenciadas */
  references?: string[];
}

export interface Amounts {
  services: number;
  deductions?: number;
  /** Modelo antigo de retenção — a NT 007 pede 0.00 aqui */
  pis?: number;
  cofins?: number;
  inss?: number;
  incomeTax?: number;
  /** Retenções agregadas de PIS/COFINS/CSLL, conforme NT 007 */
  csll?: number;
  otherWithholdings?: number;
  totalTaxes?: number;
  iss?: number;
  /**
   * Alíquota do ISS em **percentual** (3.07 = 3,07%). O serviço espera a fração
   * no XML — a conversão acontece no builder, não aqui.
   */
  rate?: number;
  unconditionalDiscount?: number;
  conditionalDiscount?: number;
  pisCofins?: PisCofins;
  approximateTaxes?: ApproximateTaxes;
  ibsCbs?: IbsCbs;
}

export interface Service {
  amounts: Amounts;
  issWithheld: YesNo;
  /** 1 = tomador, 2 = intermediário */
  withholdingResponsible?: 1 | 2;
  /** Item da lista da LC 116, ex.: "01.04" */
  serviceListItem: string;
  cnaeCode?: string | number;
  municipalTaxCode?: string;
  nbsCode?: string;
  description: string;
  /** Código IBGE do município de prestação */
  cityCode: string | number;
  countryCode?: string;
  /** 1 = exigível, 2 = não incidência, 3 = isenção, 4 = exportação, 5 = imunidade, 6/7 = suspensa */
  issTaxability: number;
  nonTaxabilityId?: string;
  incidenceCityCode?: string | number;
  processNumber?: string;
}

export interface RpsIdentification {
  number: number | string;
  series: string;
  /** 1 = RPS, 2 = Nota Fiscal Conjugada (Mista), 3 = Cupom */
  type?: 1 | 2 | 3;
}

/** Declaração de prestação de serviço — corpo de GerarNfse e de cada RPS do lote. */
export interface Rps {
  /** Ausente em emissão direta por GerarNfse */
  identification?: RpsIdentification;
  issueDate?: Date | string;
  /** 1 = normal, 2 = cancelado */
  status?: YesNo;
  replacedRps?: RpsIdentification;
  competenceDate: Date | string;
  service: Service;
  provider?: PartyIdentification;
  taker?: ServiceTaker;
  intermediary?: Intermediary;
  construction?: { workCode?: string; art?: string };
  /** 1 a 6 — ver `tsRegimeEspecialTributacao` */
  specialTaxRegime?: number;
  simplesNacionalOptant: YesNo;
  taxIncentive: YesNo;
  additionalInformation?: string;
  /** Identificador do grupo assinado; gerado automaticamente quando ausente */
  id?: string;
}

export interface RpsBatch {
  batchNumber: number | string;
  provider?: PartyIdentification;
  rps: Rps[];
  id?: string;
}

/** 1 = erro na emissão, 2 = serviço não prestado, 3 = erro de assinatura, 4 = duplicidade, 5 = erro de processamento */
export type CancellationCode = 1 | 2 | 3 | 4 | 5;

export interface CancellationRequest {
  nfseNumber: number | string;
  cancellationCode: CancellationCode;
  provider?: PartyIdentification;
  cityCode?: string | number;
  id?: string;
}

/** Declaração de serviço tomado (nota de fornecedor) — serviço `nfsc`. */
export interface PurchasedService {
  /** 2 = declaração com documento fiscal, 10 = sem documento fiscal */
  declarationType?: 2 | 10;
  identification: {
    number: number | string;
    declaredNumber?: number | string;
    series: string;
    declaredSeries?: string;
    /** 1 = RPS, 2 = Mista, 3 = Cupom */
    type: number;
  };
  nationalInvoiceKey?: string;
  issueDate: Date | string;
  competenceDate: Date | string;
  taker?: PartyIdentification;
  supplier: Supplier;
  service: PurchasedServiceDetails;
  construction?: { workCode?: string; art?: string };
}

export interface PurchasedServiceDetails {
  amounts: Amounts;
  issWithheld?: boolean;
  /** 1 = tomador, 2 = intermediário */
  withholdingResponsible: number;
  serviceListItem: string;
  cnaeCode?: string | number;
  municipalTaxCode?: string;
  nbsCode?: string;
  description: string;
  cityCode?: string | number;
  countryCode?: string | number;
  issTaxability: number;
  nonTaxabilityId?: string;
  incidenceCityCode?: string | number;
  /** Finalidade da NFS-e — obrigatória no leiaute de serviços comprados */
  purpose: number;
}

export interface PurchasedServiceBatch {
  batchNumber: string | number;
  taker?: PartyIdentification;
  invoices: PurchasedService[];
}

/** Período usado nos filtros de consulta. */
export interface DateRange {
  from: string;
  to: string;
}
