/** Tipos de domínio compartilhados pelos serviços de serviços prestados e tomados. */

export interface Identificacao {
  cnpj?: string;
  cpf?: string;
  inscricaoMunicipal?: string;
}

export interface Endereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE do município (7 dígitos) */
  codigoMunicipio: string | number;
  uf: string;
  cep: string;
}

export interface Contato {
  telefone?: string;
  email?: string;
}

/** Tomador do serviço (cliente) na emissão de NFS-e. */
export interface Tomador {
  cnpj?: string;
  cpf?: string;
  inscricaoMunicipal?: string;
  /** Número de identificação fiscal, para tomador no exterior */
  nif?: string;
  razaoSocial: string;
  endereco?: Endereco;
  contato?: Contato;
}

/** Prestador de serviço (fornecedor) na declaração de serviços tomados. */
export interface Fornecedor {
  cnpj?: string;
  cpf?: string;
  inscricaoMunicipal?: string;
  nif?: string;
  razaoSocial: string;
  nomeFantasia?: string;
  endereco?: Endereco;
  contato?: Contato;
  /** 1 a 6 — ver tsRegimeEspecialTributacao */
  regimeEspecialTributacao?: number;
  /** 1 = sim, 2 = não */
  optanteSimplesNacional?: 1 | 2;
}

export interface Intermediario {
  cnpj?: string;
  cpf?: string;
  inscricaoMunicipal?: string;
  razaoSocial: string;
  codigoMunicipio: string | number;
}

/** Grupo PIS/COFINS do tribFed (NT SE/CGNFS-e nº 007). */
export interface PisCofins {
  /** Código de Situação Tributária, ex.: "01" tributável, "08" sem incidência */
  cst: string;
  baseCalculo?: number;
  aliquotaPis?: number;
  aliquotaCofins?: number;
  /** Valor PRÓPRIO do PIS — nunca o retido */
  valorPis?: number;
  /** Valor PRÓPRIO da COFINS — nunca o retido */
  valorCofins?: number;
  /**
   * 0 = nada retido; 3 = PIS/COFINS/CSLL retidos; 4 = PIS/COFINS retidos, CSLL não;
   * 5 = só PIS; 6 = só COFINS; 7 = COFINS/CSLL; 8 = só CSLL; 9 = PIS/CSLL.
   * Os tipos 1 e 2 deixaram de ser recepcionados em 01/08/2026 (NT 007).
   */
  tipoRetencao?: 0 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Percentuais aproximados de tributos (Lei 12.741/2012). */
export interface TotalTributos {
  federal?: number;
  estadual?: number;
  municipal?: number;
  /** Percentual único para optantes do Simples Nacional */
  simplesNacional?: number;
  /** Quando não se informa estimativa alguma, envie `indicador: 0` */
  indicador?: 0;
}

/** Grupo IBS/CBS da LC 214/2025. */
export interface IbsCbs {
  /** Finalidade da NFS-e */
  finalidade: number;
  /** 0 = não é consumidor final, 1 = consumidor final */
  consumidorFinal: number;
  /** Código do indicador da operação */
  codigoIndicadorOperacao: string;
  tipoOperacao?: number;
  tipoEnteGovernamental?: number;
  /** 0 = destinatário no país */
  indicadorDestinatario: number;
  cst: string;
  classificacaoTributaria: string;
  codigoLocalidadeIncidencia?: string | number;
  percentualRedutor?: number;
  baseCalculo?: number;
  /** Chaves de NFS-e referenciadas */
  referencias?: string[];
}

export interface Valores {
  servicos: number;
  deducoes?: number;
  /** Modelo antigo de retenção — a NT 007 pede 0.00 aqui */
  pis?: number;
  cofins?: number;
  inss?: number;
  ir?: number;
  /** Retenções agregadas de PIS/COFINS/CSLL, conforme NT 007 */
  csll?: number;
  outrasRetencoes?: number;
  totalTributos?: number;
  iss?: number;
  aliquota?: number;
  descontoIncondicionado?: number;
  descontoCondicionado?: number;
  pisCofins?: PisCofins;
  totalAproximadoTributos?: TotalTributos;
  ibsCbs?: IbsCbs;
}

export interface Servico {
  valores: Valores;
  /** 1 = sim, 2 = não */
  issRetido: 1 | 2;
  /** 1 = tomador, 2 = intermediário */
  responsavelRetencao?: 1 | 2;
  /** Item da lista da LC 116, ex.: "1.04" */
  itemListaServico: string;
  codigoCnae?: string | number;
  codigoTributacaoMunicipio?: string;
  codigoNbs?: string;
  discriminacao: string;
  /** Código IBGE do município de prestação */
  codigoMunicipio: string | number;
  codigoPais?: string;
  /** 1 = exigível, 2 = não incidência, 3 = isenção, 4 = exportação, 5 = imunidade, 6/7 = suspensa */
  exigibilidadeIss: number;
  identificacaoNaoExigibilidade?: string;
  municipioIncidencia?: string | number;
  numeroProcesso?: string;
}

export interface IdentificacaoRps {
  numero: number | string;
  serie: string;
  /** 1 = RPS, 2 = Nota Fiscal Conjugada (Mista), 3 = Cupom */
  tipo?: 1 | 2 | 3;
}

/** Declaração de prestação de serviço — o corpo de GerarNfse e de cada RPS do lote. */
export interface Rps {
  /** Identificação do RPS. Ausente em emissão direta por GerarNfse. */
  identificacao?: IdentificacaoRps;
  dataEmissao?: Date | string;
  /** 1 = normal, 2 = cancelado */
  status?: 1 | 2;
  rpsSubstituido?: IdentificacaoRps;
  /** Data de competência (AAAA-MM-DD) */
  competencia: Date | string;
  servico: Servico;
  prestador?: Identificacao;
  tomador?: Tomador;
  intermediario?: Intermediario;
  construcaoCivil?: { codigoObra?: string; art?: string };
  /** 1 a 6 — ver tsRegimeEspecialTributacao */
  regimeEspecialTributacao?: number;
  /** 1 = sim, 2 = não */
  optanteSimplesNacional: 1 | 2;
  /** 1 = sim, 2 = não */
  incentivoFiscal: 1 | 2;
  informacoesComplementares?: string;
  /** Identificador do grupo assinado; gerado automaticamente quando ausente */
  id?: string;
}

export interface LoteRps {
  numeroLote: number | string;
  prestador?: Identificacao;
  rps: Rps[];
  id?: string;
}

/** 1 = erro na emissão, 2 = serviço não prestado, 3 = erro de assinatura, 4 = duplicidade, 5 = erro de processamento */
export type CodigoCancelamento = 1 | 2 | 3 | 4 | 5;

export interface PedidoCancelamento {
  numeroNfse: number | string;
  codigoCancelamento: CodigoCancelamento;
  prestador?: Identificacao;
  codigoMunicipio?: string | number;
  id?: string;
}

/** Declaração de serviço tomado (nota de fornecedor) — serviço `nfsc`. */
export interface ServicoComprado {
  /** 2 = declaração com documento fiscal, 10 = sem documento fiscal */
  tipoDeclaracao?: 2 | 10;
  identificacao: {
    numero: number | string;
    numeroDeclarado?: number | string;
    serie: string;
    serieDeclarada?: string;
    /** 1 = RPS, 2 = Mista, 3 = Cupom */
    tipo: number;
  };
  chaveNotaNacional?: string;
  dataEmissao: Date | string;
  competencia: Date | string;
  tomador?: Identificacao;
  fornecedor: Fornecedor;
  servico: ServicoCompradoDados;
  construcaoCivil?: { codigoObra?: string; art?: string };
}

export interface ServicoCompradoDados {
  valores: Valores;
  issRetido?: boolean;
  /** 1 = tomador, 2 = intermediário */
  responsavelRetencao: number;
  itemListaServico: string;
  codigoCnae?: string | number;
  codigoTributacaoMunicipio?: string;
  codigoNbs?: string;
  discriminacao: string;
  codigoMunicipio?: string | number;
  codigoPais?: string | number;
  exigibilidadeIss: number;
  identificacaoNaoExigibilidade?: string;
  municipioIncidencia?: string | number;
  /** Finalidade da NFS-e (obrigatório no leiaute de serviços comprados) */
  finalidade: number;
}

export interface LoteServicoComprado {
  numeroRemessa: string | number;
  tomador?: Identificacao;
  notas: ServicoComprado[];
}
