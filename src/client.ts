import { XMLParser } from "fast-xml-parser";
import { carregarCertificado, type Certificado } from "./cert.ts";
import { carregarConfig, type GissConfig } from "./config.ts";
import * as prestados from "./messages/prestados.ts";
import * as tomados from "./messages/tomados.ts";
import { assinarXml } from "./sign.ts";
import {
  chamar,
  type Operacao,
  type OperacaoNfsc,
  type OperacaoNfse,
  type Servico,
} from "./soap.ts";
import type {
  Identificacao,
  LoteRps,
  LoteServicoComprado,
  PedidoCancelamento,
  Rps,
  ServicoComprado,
} from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  ignoreDeclaration: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export interface MensagemRetorno {
  codigo: string;
  mensagem: string;
  correcao?: string;
}

/** Erro de negócio devolvido pelo Web Service (ListaMensagemRetorno). */
export class GissError extends Error {
  readonly operacao: Operacao;
  readonly mensagens: MensagemRetorno[];
  readonly xml: string;

  constructor(operacao: Operacao, mensagens: MensagemRetorno[], xml: string) {
    super(
      `${operacao}: ${mensagens.map((m) => `[${m.codigo}] ${m.mensagem}`).join(" | ")}`,
    );
    this.name = "GissError";
    this.operacao = operacao;
    this.mensagens = mensagens;
    this.xml = xml;
  }
}

export interface Nfse {
  numero: string;
  codigoVerificacao: string;
  dataEmissao: string;
  competencia?: string;
  valorServicos?: string;
  valorLiquido?: string;
  valorIss?: string;
  discriminacao?: string;
  prestador?: Participante;
  tomador?: Participante;
  /** Estrutura completa do CompNfse, para os campos não normalizados */
  bruto: Record<string, unknown>;
}

export interface Participante {
  documento?: string;
  inscricaoMunicipal?: string;
  razaoSocial?: string;
  email?: string;
  municipio?: string;
}

export interface ResultadoConsulta {
  notas: Nfse[];
  pagina?: string;
  alertas: MensagemRetorno[];
  xml: string;
}

export const SITUACAO_LOTE: Record<string, string> = {
  "1": "Não recebido",
  "2": "Não processado",
  "3": "Processado com erro",
  "4": "Processado com sucesso",
};

export interface ResultadoLote extends ResultadoConsulta {
  situacao: string;
  situacaoDescricao: string;
  numeroLote?: string;
  protocolo?: string;
  dataRecebimento?: string;
}

/** Retorno de RecepcionarLoteRps — o processamento é assíncrono. */
export interface ProtocoloLote {
  numeroLote?: string;
  dataRecebimento?: string;
  protocolo?: string;
  alertas: MensagemRetorno[];
  xml: string;
}

export interface ResultadoCancelamento {
  numeroNfse?: string;
  dataHoraCancelamento?: string;
  alertas: MensagemRetorno[];
  xml: string;
}

export interface OpcoesCliente extends Partial<GissConfig> {
  /** Loga na saída de erro os XMLs enviados e recebidos */
  debug?: boolean;
}

export class GissClient {
  readonly config: GissConfig;
  readonly certificado: Certificado;
  private readonly debug: boolean;

  constructor(opcoes: OpcoesCliente = {}) {
    const { debug = false, ...overrides } = opcoes;
    this.config = carregarConfig(overrides);
    this.certificado = carregarCertificado(
      this.config.certPath,
      this.config.certPassword,
    );
    this.debug = debug;
  }

  /** Identificação do prestador configurado no .env */
  get prestador(): Identificacao {
    return {
      cnpj: this.config.cnpj,
      inscricaoMunicipal: this.config.inscricaoMunicipal,
    };
  }

  // -------------------------------------------------------------------------
  // Emissão (serviços prestados)
  // -------------------------------------------------------------------------

  /** Emite uma NFS-e diretamente, sem passar por lote. Processamento síncrono. */
  async gerarNfse(rps: Rps): Promise<ResultadoConsulta> {
    const id = prestados.idDoRps(rps);
    const xml = await this.executar(
      "nfse",
      "GerarNfse",
      prestados.gerarNfseEnvio(rps, this.prestador, this.config.versao),
      {
        xpath: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
        id,
        xpathDestino: "//*[local-name(.)='Rps']",
      },
    );
    return montarResultado(xml);
  }

  /**
   * Monta e assina o XML de emissão sem enviá-lo — para conferência e para
   * validar contra os XSD antes de gerar uma nota de verdade.
   */
  previewGerarNfse(rps: Rps): string {
    return assinarXml(
      prestados.gerarNfseEnvio(rps, this.prestador, this.config.versao),
      this.certificado,
      {
        xpath: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
        id: prestados.idDoRps(rps),
        xpathDestino: "//*[local-name(.)='Rps']",
      },
    );
  }

  /** Envia um lote de até 50 RPS. Retorna protocolo; o resultado sai em ConsultarLoteRps. */
  async enviarLoteRps(lote: LoteRps): Promise<ProtocoloLote> {
    this.validarLote(lote);
    const xml = await this.executar(
      "nfse",
      "RecepcionarLoteRps",
      this.assinarLote(
        prestados.enviarLoteRpsEnvio(lote, this.prestador, this.config.versao),
        lote,
      ),
      "nenhuma",
    );
    return montarProtocolo(xml);
  }

  /** Envia um lote de até 50 RPS e devolve as NFS-e na mesma conexão. */
  async enviarLoteRpsSincrono(lote: LoteRps): Promise<ResultadoLote> {
    this.validarLote(lote);
    const xml = await this.executar(
      "nfse",
      "RecepcionarLoteRpsSincrono",
      this.assinarLote(
        prestados.enviarLoteRpsSincronoEnvio(
          lote,
          this.prestador,
          this.config.versao,
        ),
        lote,
      ),
      "nenhuma",
    );
    return montarResultadoLote(xml);
  }

  /**
   * Aplica as duas assinaturas que o serviço exige em um lote:
   *
   * 1. cada RPS, referenciando o Id do seu `InfDeclaracaoPrestacaoServico` — o
   *    manual diz que basta assinar o lote, mas sem elas vem `E174`;
   * 2. o lote, referenciando o Id de `LoteRps`.
   *
   * A URI do lote precisa apontar para o Id: assinar o documento inteiro
   * (`URI=""`) invalida as assinaturas dos RPS e o serviço volta a acusar E174.
   */
  private assinarLote(xml: string, lote: LoteRps): string {
    let resultado = xml;
    for (const rps of lote.rps) {
      const id = prestados.idDoRps(rps);
      resultado = assinarXml(resultado, this.certificado, {
        xpath: `//*[local-name(.)='InfDeclaracaoPrestacaoServico'][@Id='${id}']`,
        id,
        xpathDestino: `//*[local-name(.)='Rps'][*[@Id='${id}']]`,
      });
    }
    return assinarXml(resultado, this.certificado, {
      xpath: "//*[local-name(.)='LoteRps']",
      id: lote.id ?? `lote${lote.numeroLote}`,
      xpathDestino: "/*",
    });
  }

  /** Cancela uma NFS-e pelo número, informando o motivo. */
  async cancelarNfse(
    pedido: PedidoCancelamento,
  ): Promise<ResultadoCancelamento> {
    const xml = await this.executar(
      "nfse",
      "CancelarNfse",
      prestados.cancelarNfseEnvio(
        pedido,
        this.prestador,
        this.config.codigoMunicipio,
        this.config.versao,
      ),
      {
        xpath: "//*[local-name(.)='InfPedidoCancelamento']",
        id: pedido.id ?? `canc${pedido.numeroNfse}`,
        xpathDestino: "//*[local-name(.)='Pedido']",
      },
    );
    return montarCancelamento(xml);
  }

  /** Cancela uma NFS-e e emite outra em substituição, numa única operação. */
  async substituirNfse(
    pedido: PedidoCancelamento,
    rps: Rps,
  ): Promise<ResultadoConsulta> {
    // Como no lote: o Rps embutido leva a própria assinatura e o envelope de
    // substituição é assinado referenciando o Id de SubstituicaoNfse.
    const idRps = prestados.idDoRps(rps);
    let envio = prestados.substituirNfseEnvio(
      pedido,
      rps,
      this.prestador,
      this.config.codigoMunicipio,
      this.config.versao,
    );
    envio = assinarXml(envio, this.certificado, {
      xpath: `//*[local-name(.)='InfDeclaracaoPrestacaoServico'][@Id='${idRps}']`,
      id: idRps,
      xpathDestino: `//*[local-name(.)='Rps'][*[@Id='${idRps}']]`,
    });
    envio = assinarXml(envio, this.certificado, {
      xpath: "//*[local-name(.)='InfPedidoCancelamento']",
      id: pedido.id ?? `canc${pedido.numeroNfse}`,
      xpathDestino: "//*[local-name(.)='Pedido']",
    });
    envio = assinarXml(envio, this.certificado, {
      xpath: "//*[local-name(.)='SubstituicaoNfse']",
      id: `subst${pedido.numeroNfse}`,
      xpathDestino: "/*",
    });

    const xml = await this.executar("nfse", "SubstituirNfse", envio, "nenhuma");
    return montarResultado(xml);
  }

  private validarLote(lote: LoteRps): void {
    if (lote.rps.length === 0) throw new Error("Lote sem RPS");
    if (lote.rps.length > 50) {
      throw new Error(`Lote com ${lote.rps.length} RPS — o limite é 50 por lote`);
    }
  }

  // -------------------------------------------------------------------------
  // Consultas (serviços prestados)
  // -------------------------------------------------------------------------

  /** Consulta o resultado do processamento de um lote de RPS pelo protocolo. */
  async consultarLoteRps(
    protocolo: string,
    prestador = this.prestador,
  ): Promise<ResultadoLote> {
    const xml = await this.executar(
      "nfse",
      "ConsultarLoteRps",
      prestados.consultarLoteRpsEnvio({
        prestador,
        protocolo,
        versao: this.config.versao,
      }),
    );
    return montarResultadoLote(xml);
  }

  /** Consulta NFS-e emitidas dentro de uma faixa de numeração (até 50 por página). */
  async consultarNfsePorFaixa(args: {
    numeroInicial: number | string;
    numeroFinal: number | string;
    pagina?: number;
    prestador?: Identificacao;
  }): Promise<ResultadoConsulta> {
    const xml = await this.executar(
      "nfse",
      "ConsultarNfsePorFaixa",
      prestados.consultarNfseFaixaEnvio({
        prestador: args.prestador ?? this.prestador,
        numeroInicial: args.numeroInicial,
        numeroFinal: args.numeroFinal,
        pagina: args.pagina,
        versao: this.config.versao,
      }),
    );
    return montarResultado(xml);
  }

  /** Consulta a NFS-e gerada a partir de um RPS (número + série + tipo). */
  async consultarNfsePorRps(args: {
    numero: number | string;
    serie: string;
    tipo?: 1 | 2 | 3;
    prestador?: Identificacao;
  }): Promise<ResultadoConsulta> {
    const xml = await this.executar(
      "nfse",
      "ConsultarNfsePorRps",
      prestados.consultarNfseRpsEnvio({
        prestador: args.prestador ?? this.prestador,
        numero: args.numero,
        serie: args.serie,
        tipo: args.tipo,
        versao: this.config.versao,
      }),
    );
    return montarResultado(xml);
  }

  /**
   * Consulta NFS-e emitidas pelo prestador por período de emissão, período de
   * competência ou número de nota. Retorna até 50 notas por página.
   */
  async consultarNfseServicoPrestado(args: {
    numeroNfse?: number | string;
    periodoEmissao?: { inicial: string; final: string };
    periodoCompetencia?: { inicial: string; final: string };
    tomador?: Identificacao;
    intermediario?: Identificacao;
    pagina?: number;
    prestador?: Identificacao;
  }): Promise<ResultadoConsulta> {
    const xml = await this.executar(
      "nfse",
      "ConsultarNfseServicoPrestado",
      prestados.consultarNfseServicoPrestadoEnvio({
        ...args,
        prestador: args.prestador ?? this.prestador,
        versao: this.config.versao,
      }),
    );
    return montarResultado(xml);
  }

  /** Consulta NFS-e em que a empresa aparece como tomadora (notas de fornecedores). */
  async consultarNfseServicoTomado(args: {
    numeroNfse?: number | string;
    periodoEmissao?: { inicial: string; final: string };
    periodoCompetencia?: { inicial: string; final: string };
    prestador?: Identificacao;
    tomador?: Identificacao;
    intermediario?: Identificacao;
    pagina?: number;
    consulente?: Identificacao;
  }): Promise<ResultadoConsulta> {
    const xml = await this.executar(
      "nfse",
      "ConsultarNfseServicoTomado",
      prestados.consultarNfseServicoTomadoEnvio({
        ...args,
        consulente: args.consulente ?? this.prestador,
        versao: this.config.versao,
      }),
      "nenhuma",
    );
    return montarResultado(xml);
  }

  /**
   * Percorre todas as páginas de uma consulta paginada até esgotar os
   * resultados (o serviço devolve no máximo 50 notas por página).
   */
  async *paginar(
    consulta: (pagina: number) => Promise<ResultadoConsulta>,
    limitePaginas = 200,
  ): AsyncGenerator<ResultadoConsulta> {
    for (let pagina = 1; pagina <= limitePaginas; pagina++) {
      const resultado = await consulta(pagina);
      yield resultado;
      if (resultado.notas.length < 50) return;
    }
  }

  // -------------------------------------------------------------------------
  // Serviços tomados (serviço nfsc)
  // -------------------------------------------------------------------------

  /** Declara uma nota de serviço tomado (nota de fornecedor), uma a uma. */
  async emitirNotaServicoComprado(nota: ServicoComprado): Promise<ProtocoloLote> {
    const xml = await this.executar(
      "nfsc",
      "EmitirNotaServicoComprado",
      tomados.emitirNotaServicoCompradoEnvio(nota, this.prestador),
    );
    return montarProtocolo(xml);
  }

  /** Declara um lote de notas de serviço tomado (até 50 por lote). */
  async enviarLoteNotaServicoComprado(
    lote: LoteServicoComprado,
  ): Promise<ProtocoloLote> {
    if (lote.notas.length === 0) throw new Error("Lote sem notas");
    if (lote.notas.length > 50) {
      throw new Error(
        `Lote com ${lote.notas.length} notas — o limite é 50 por lote`,
      );
    }
    const xml = await this.executar(
      "nfsc",
      "EnviarLoteNotaServicoComprado",
      tomados.enviarLoteNotaServicoCompradoEnvio(lote, this.prestador),
    );
    return montarProtocolo(xml);
  }

  /** Cancela uma nota de serviço tomado pelo código de verificação. */
  async cancelarNotaServicoComprado(args: {
    codigoVerificacao: string;
    codigoCancelamento: number;
    tomador?: Identificacao;
    codigoMunicipio?: string | number;
  }): Promise<ResultadoCancelamento> {
    const xml = await this.executar(
      "nfsc",
      "CancelarNotaServicoComprado",
      tomados.cancelarNotaServicoCompradoEnvio({
        codigoVerificacao: args.codigoVerificacao,
        tomador: args.tomador ?? this.prestador,
        codigoMunicipio: args.codigoMunicipio ?? this.config.codigoMunicipio,
        codigoCancelamento: args.codigoCancelamento,
      }),
    );
    return montarCancelamento(xml);
  }

  /**
   * Consulta notas de serviço tomado por número/série declarados e período.
   * Apesar de o XSD marcar `NumeroDeclarado` e `SerieDeclarada` como opcionais,
   * o serviço responde HTTP 400 quando eles faltam.
   */
  async consultarServicoCompradoPorNumero(args: {
    periodoCompetencia: { inicial: string; final?: string };
    periodoEmissao: { inicial: string; final?: string };
    numeroDeclarado: number | string;
    serieDeclarada: string;
    tomador?: Identificacao;
  }): Promise<ResultadoConsulta> {
    if (!args.numeroDeclarado || !args.serieDeclarada) {
      throw new Error(
        "ConsultarServicoCompradoPorNumero exige numeroDeclarado e serieDeclarada",
      );
    }
    const xml = await this.executar(
      "nfsc",
      "ConsultarServicoCompradoPorNumero",
      tomados.consultarServicoCompradoPorNumeroEnvio({
        ...args,
        tomador: args.tomador ?? this.prestador,
      }),
    );
    return montarResultado(xml);
  }

  /** Consulta as notas declaradas em um lote. */
  async consultarServicoCompradoPorLote(
    protocolo: string,
    tomador = this.prestador,
  ): Promise<ResultadoConsulta> {
    const xml = await this.executar(
      "nfsc",
      "ConsultarServicoCompradoPorLote",
      tomados.consultarServicoCompradoPorLoteEnvio({ tomador, protocolo }),
    );
    return montarResultado(xml);
  }

  /** Consulta a situação de processamento de um protocolo de serviços tomados. */
  async consultarServicoCompradoPorProtocolo(
    protocolo: string,
    tomador = this.prestador,
  ): Promise<ResultadoLote> {
    const xml = await this.executar(
      "nfsc",
      "ConsultarServicoCompradoPorProtocolo",
      tomados.consultarServicoCompradoPorProtocoloEnvio({ tomador, protocolo }),
    );
    return montarResultadoLote(xml);
  }

  // -------------------------------------------------------------------------

  /**
   * Assina, envia e valida a resposta de uma operação.
   *
   * Nem todo schema aceita `Signature`: `consultar-nfse-servico-tomado-envio`
   * não declara o elemento, e assinar lá devolve `E160 — arquivo em desacordo
   * com o XML Schema`. Em `gerar-nfse` e `cancelar-nfse` a assinatura vai num
   * grupo interno, não na raiz.
   */
  private async executar(
    servico: Servico,
    operacao: OperacaoNfse | OperacaoNfsc,
    dados: string,
    assinatura?: { xpath: string; id: string; xpathDestino: string } | "nenhuma",
  ): Promise<string> {
    const assinado =
      assinatura === "nenhuma"
        ? dados
        : assinarXml(dados, this.certificado, assinatura);

    if (this.debug) {
      console.error(`\n--- ${operacao} envio ---\n${assinado}`);
    }

    const resposta = await chamar(operacao, assinado, {
      host: this.config.host,
      servico,
      certificado: this.certificado,
      cabecalho: servico === "nfse"
        ? prestados.montarCabecalho(this.config.versao)
        : undefined,
    });

    if (this.debug) {
      console.error(`\n--- ${operacao} retorno ---\n${resposta.xml}`);
    }

    const erros = extrairMensagens(parser.parse(resposta.xml), "MensagemRetorno");
    if (erros.length > 0) throw new GissError(operacao, erros, resposta.xml);

    return resposta.xml;
  }
}

// ---------------------------------------------------------------------------
// Normalização das respostas
// ---------------------------------------------------------------------------

function montarResultado(xml: string): ResultadoConsulta {
  const resposta = raiz(parser.parse(xml));
  return {
    notas: extrairNotas(resposta),
    pagina: texto(buscar(resposta, "Pagina")[0]),
    alertas: extrairMensagens(resposta, "MensagemAlertaRetorno"),
    xml,
  };
}

function montarResultadoLote(xml: string): ResultadoLote {
  const resposta = raiz(parser.parse(xml));
  const situacao = String(texto(buscar(resposta, "Situacao")[0]) ?? "");
  return {
    ...montarResultado(xml),
    situacao,
    situacaoDescricao: SITUACAO_LOTE[situacao] ?? "Desconhecida",
    numeroLote: texto(buscar(resposta, "NumeroLote")[0]),
    protocolo: texto(buscar(resposta, "Protocolo")[0]),
    dataRecebimento: texto(buscar(resposta, "DataRecebimento")[0]),
  };
}

function montarProtocolo(xml: string): ProtocoloLote {
  const resposta = raiz(parser.parse(xml));
  return {
    numeroLote: texto(buscar(resposta, "NumeroLote")[0]),
    dataRecebimento: texto(buscar(resposta, "DataRecebimento")[0]),
    protocolo: texto(buscar(resposta, "Protocolo")[0]),
    alertas: extrairMensagens(resposta, "MensagemAlertaRetorno"),
    xml,
  };
}

function montarCancelamento(xml: string): ResultadoCancelamento {
  const resposta = raiz(parser.parse(xml));
  return {
    numeroNfse: texto(buscar(resposta, "Numero")[0]),
    dataHoraCancelamento: texto(buscar(resposta, "DataHora")[0]),
    alertas: extrairMensagens(resposta, "MensagemAlertaRetorno"),
    xml,
  };
}

/** Descarta o elemento raiz nomeado e devolve seu conteúdo. */
function raiz(objeto: unknown): unknown {
  if (!objeto || typeof objeto !== "object") return objeto;
  const valores = Object.values(objeto as Record<string, unknown>);
  return valores[0] ?? objeto;
}

const lista = <T,>(valor: T | T[] | undefined): T[] =>
  valor === undefined || valor === null ? [] : Array.isArray(valor) ? valor : [valor];

function texto(valor: unknown): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor === "object") return undefined;
  return String(valor);
}

/** Coleta recursivamente todos os valores associados a uma chave. */
function buscar(no: unknown, chave: string): unknown[] {
  if (!no || typeof no !== "object") return [];
  const encontrados: unknown[] = [];
  for (const [nome, valor] of Object.entries(no as Record<string, unknown>)) {
    if (nome === chave) encontrados.push(...lista(valor));
    else encontrados.push(...buscar(valor, chave));
  }
  return encontrados;
}

function extrairMensagens(no: unknown, chave: string): MensagemRetorno[] {
  return buscar(no, chave).map((item) => {
    const registro = (item ?? {}) as Record<string, unknown>;
    return {
      codigo: texto(registro["Codigo"]) ?? "",
      mensagem: texto(registro["Mensagem"]) ?? "",
      correcao: texto(registro["Correcao"]),
    };
  });
}

function participante(no: unknown): Participante {
  const registro = (no ?? {}) as Record<string, unknown>;
  const documento = (buscar(registro, "CpfCnpj")[0] ?? {}) as Record<string, unknown>;
  const endereco = (buscar(registro, "Endereco")[0] ?? {}) as Record<string, unknown>;
  return {
    documento: texto(documento["Cnpj"]) ?? texto(documento["Cpf"]),
    inscricaoMunicipal: texto(buscar(registro, "InscricaoMunicipal")[0]),
    razaoSocial: texto(buscar(registro, "RazaoSocial")[0]),
    email: texto(buscar(registro, "Email")[0]),
    municipio: texto(endereco["CodigoMunicipio"]),
  };
}

function extrairNotas(no: unknown): Nfse[] {
  return buscar(no, "CompNfse").map((comp) => {
    const registro = (comp ?? {}) as Record<string, unknown>;
    const inf = (buscar(registro, "InfNfse")[0] ?? {}) as Record<string, unknown>;
    const valores = (buscar(inf, "ValoresNfse")[0] ?? {}) as Record<string, unknown>;
    const servico = (buscar(inf, "Servico")[0] ?? {}) as Record<string, unknown>;

    return {
      numero: texto(inf["Numero"]) ?? "",
      codigoVerificacao: texto(inf["CodigoVerificacao"]) ?? "",
      dataEmissao: texto(inf["DataEmissao"]) ?? "",
      competencia: texto(buscar(inf, "Competencia")[0]),
      valorServicos: texto(buscar(servico, "ValorServicos")[0]),
      valorLiquido: texto(valores["ValorLiquidoNfse"]),
      valorIss: texto(valores["ValorIss"]),
      discriminacao: texto(buscar(servico, "Discriminacao")[0]),
      prestador: participante(buscar(inf, "PrestadorServico")[0]),
      tomador: participante(buscar(inf, "TomadorServico")[0]),
      bruto: registro,
    };
  });
}
