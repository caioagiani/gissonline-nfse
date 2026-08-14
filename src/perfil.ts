import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IbsCbs, PisCofins, Rps, TotalTributos, Tomador } from "./types.ts";

/**
 * Valores fiscais que se repetem em toda emissão do prestador. Os padrões abaixo
 * foram extraídos de uma NFS-e real já aceita pela prefeitura de Suzano
 * (nota 569, competência 07/2026) — servem de ponto de partida, mas cada
 * prestador deve conferir com sua contabilidade antes de emitir.
 */
export interface PerfilEmissao {
  /** Item da lista da LC 116 */
  itemListaServico: string;
  codigoCnae?: string;
  codigoTributacaoMunicipio?: string;
  codigoNbs?: string;
  /** Código IBGE do município de prestação */
  codigoMunicipio: string;
  codigoPais?: string;
  /** 1 = exigível, 2 = não incidência, 3 = isenção, 4 = exportação... */
  exigibilidadeIss: number;
  municipioIncidencia?: string;
  /** 1 = sim, 2 = não */
  optanteSimplesNacional: 1 | 2;
  /** 1 = sim, 2 = não */
  incentivoFiscal: 1 | 2;
  /** 1 = sim, 2 = não */
  issRetido: 1 | 2;
  /** 1 a 6 — ver tsRegimeEspecialTributacao */
  regimeEspecialTributacao?: number;
  /** Série usada nos RPS */
  serie: string;
  discriminacaoPadrao?: string;
  pisCofins?: PisCofins;
  totalAproximadoTributos?: TotalTributos;
  ibsCbs?: Omit<IbsCbs, "baseCalculo">;
}

export const PERFIL_PADRAO: PerfilEmissao = {
  // O envio exige dois dígitos no item da lista ("01.04"), enquanto a resposta
  // da consulta devolve "1.04". Mesma diferença no NBS: no envio vai sem pontos.
  itemListaServico: "01.04",
  codigoCnae: "6201501",
  codigoTributacaoMunicipio: "6201501",
  codigoNbs: "115021000",
  codigoMunicipio: "3552502",
  codigoPais: "0076",
  exigibilidadeIss: 1,
  municipioIncidencia: "3552502",
  optanteSimplesNacional: 1,
  incentivoFiscal: 2,
  issRetido: 2,
  serie: "A",
  pisCofins: {
    cst: "08", // sem incidência da contribuição
    baseCalculo: 0,
    aliquotaPis: 0,
    aliquotaCofins: 0,
    valorPis: 0,
    valorCofins: 0,
    tipoRetencao: 0,
  },
  totalAproximadoTributos: { simplesNacional: 0 },
  ibsCbs: {
    // finNFSe no envio só aceita 0 (NFS-e normal); a consulta devolve 1.
    finalidade: 0,
    consumidorFinal: 0,
    codigoIndicadorOperacao: "100301",
    tipoOperacao: 1,
    tipoEnteGovernamental: 4,
    indicadorDestinatario: 0,
    cst: "000",
    classificacaoTributaria: "000001",
    // Código IBGE de 7 dígitos, não o índice devolvido na consulta.
    codigoLocalidadeIncidencia: "3552502",
    percentualRedutor: 0,
  },
};

export function carregarPerfil(caminho = "dados/perfil.json"): PerfilEmissao {
  const arquivo = resolve(caminho);
  if (!existsSync(arquivo)) return PERFIL_PADRAO;
  const salvo = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<PerfilEmissao>;
  return { ...PERFIL_PADRAO, ...salvo };
}

export function salvarPerfil(
  perfil: PerfilEmissao,
  caminho = "dados/perfil.json",
): string {
  const arquivo = resolve(caminho);
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${JSON.stringify(perfil, null, 2)}\n`);
  return arquivo;
}

export interface DadosEmissao {
  tomador: Tomador;
  valorServicos: number;
  discriminacao?: string;
  competencia?: Date | string;
  dataEmissao?: Date | string;
  /** Informe para emitir via RPS; ausente gera NFS-e direta */
  numeroRps?: number | string;
  serie?: string;
  tipoRps?: 1 | 2 | 3;
  /** Retenções federais — a NT 007 pede o total agregado em `csll` */
  csll?: number;
  inss?: number;
  ir?: number;
  outrasRetencoes?: number;
  deducoes?: number;
  descontoIncondicionado?: number;
  descontoCondicionado?: number;
  informacoesComplementares?: string;
  /** Sobrescreve campos do perfil nesta emissão */
  perfil?: Partial<PerfilEmissao>;
}

/** Compõe o RPS completo a partir do perfil e dos poucos dados que variam por nota. */
export function montarRps(base: PerfilEmissao, dados: DadosEmissao): Rps {
  const perfil = { ...base, ...dados.perfil };
  const competencia = dados.competencia ?? new Date();
  const discriminacao =
    dados.discriminacao ?? perfil.discriminacaoPadrao ?? "";

  if (!discriminacao) {
    throw new Error(
      "Informe a discriminação do serviço (ou defina discriminacaoPadrao no perfil)",
    );
  }

  return {
    identificacao: dados.numeroRps
      ? {
          numero: dados.numeroRps,
          serie: dados.serie ?? perfil.serie,
          tipo: dados.tipoRps ?? 1,
        }
      : undefined,
    dataEmissao: dados.dataEmissao ?? new Date(),
    status: 1,
    competencia,
    servico: {
      valores: {
        servicos: dados.valorServicos,
        deducoes: dados.deducoes ?? 0,
        pis: 0, // a NT 007 exige 0.00 nas tags antigas
        cofins: 0,
        inss: dados.inss ?? 0,
        ir: dados.ir ?? 0,
        csll: dados.csll ?? 0,
        outrasRetencoes: dados.outrasRetencoes ?? 0,
        totalTributos: 0,
        descontoIncondicionado: dados.descontoIncondicionado ?? 0,
        descontoCondicionado: dados.descontoCondicionado ?? 0,
        pisCofins: perfil.pisCofins,
        totalAproximadoTributos: perfil.totalAproximadoTributos,
        ibsCbs: perfil.ibsCbs
          ? { ...perfil.ibsCbs, baseCalculo: dados.valorServicos }
          : undefined,
      },
      issRetido: perfil.issRetido,
      itemListaServico: perfil.itemListaServico,
      codigoCnae: perfil.codigoCnae,
      codigoTributacaoMunicipio: perfil.codigoTributacaoMunicipio,
      codigoNbs: perfil.codigoNbs,
      discriminacao,
      codigoMunicipio: perfil.codigoMunicipio,
      codigoPais: perfil.codigoPais,
      exigibilidadeIss: perfil.exigibilidadeIss,
      municipioIncidencia: perfil.municipioIncidencia,
    },
    tomador: dados.tomador,
    regimeEspecialTributacao: perfil.regimeEspecialTributacao,
    optanteSimplesNacional: perfil.optanteSimplesNacional,
    incentivoFiscal: perfil.incentivoFiscal,
    informacoesComplementares: dados.informacoesComplementares,
  };
}
