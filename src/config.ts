import { resolve } from "node:path";
import { somenteDigitos } from "./xml.ts";

export type Ambiente = "producao" | "homologacao";

export interface GissConfig {
  ambiente: Ambiente;
  municipio: string;
  /** Host base dos Web Services, ex.: `https://ws-suzano.giss.com.br` */
  host: string;
  certPath: string;
  certPassword: string;
  /** CNPJ do prestador, somente dígitos */
  cnpj: string;
  /** Inscrição municipal do prestador */
  inscricaoMunicipal: string;
  /** Código IBGE do município (7 dígitos) */
  codigoMunicipio: string;
  /** Versão do leiaute usada no cabeçalho e nos namespaces */
  versao: string;
}

/** Credenciais do portal web — usadas só pela API REST de cadastro. */
export function carregarCredenciaisPortal(config: GissConfig) {
  return {
    login: obrigatorio("GISS_LOGIN"),
    senha: obrigatorio("GISS_PASS"),
    codigoMunicipio: config.codigoMunicipio,
    cnpj: config.cnpj,
  };
}

function obrigatorio(chave: string): string {
  const valor = process.env[chave]?.trim().replace(/^"|"$/g, "");
  if (!valor) throw new Error(`Variável de ambiente ausente: ${chave}`);
  return valor;
}

function opcional(chave: string, padrao: string): string {
  const valor = process.env[chave]?.trim().replace(/^"|"$/g, "");
  return valor || padrao;
}

export function hostDe(ambiente: Ambiente, municipio: string): string {
  // O manual de Serviços Prestados v1.6 aponta `ws-homologacao`, mas esse host
  // só serve o portal (405 no POST). O ambiente SOAP ativo é o `-rtc`, citado
  // no Manual Técnico PIS/COFINS/CSLL v1.0.
  const host = ambiente === "homologacao" ? "ws-homologacao-rtc" : `ws-${municipio}`;
  return `https://${host}.giss.com.br`;
}

export function carregarConfig(overrides: Partial<GissConfig> = {}): GissConfig {
  const ambiente = (overrides.ambiente ??
    opcional("GISS_ENV", "producao")) as Ambiente;
  if (ambiente !== "producao" && ambiente !== "homologacao") {
    throw new Error(`GISS_ENV inválido: ${ambiente} (use producao|homologacao)`);
  }

  const municipio = overrides.municipio ?? opcional("GISS_MUNICIPIO", "suzano");

  return {
    ambiente,
    municipio,
    host: overrides.host ?? hostDe(ambiente, municipio),
    certPath: resolve(overrides.certPath ?? obrigatorio("CERT_PATH")),
    certPassword: overrides.certPassword ?? obrigatorio("CERT_PASSWORD"),
    cnpj: somenteDigitos(overrides.cnpj ?? obrigatorio("GISS_CNPJ")),
    inscricaoMunicipal:
      overrides.inscricaoMunicipal ?? obrigatorio("GISS_ISC_MUNICIPAL"),
    codigoMunicipio:
      overrides.codigoMunicipio ?? opcional("GISS_CODIGO_MUNICIPIO", "3552502"),
    versao: overrides.versao ?? opcional("GISS_VERSAO", "2.04"),
  };
}
