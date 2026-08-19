import { resolve } from "node:path";
import { digitsOnly } from "../infra/xml.ts";
import { findMunicipality } from "./municipalities.ts";

export type Environment = "producao" | "homologacao";

export interface GissConfig {
  environment: Environment;
  city: string;
  /** Host base dos Web Services, ex.: `https://ws-suzano.giss.com.br` */
  host: string;
  certificatePath: string;
  certificatePassword: string;
  /** CNPJ do prestador, somente dígitos */
  cnpj: string;
  municipalRegistration: string;
  /** Código IBGE do município (7 dígitos) */
  cityCode: string;
  /** Versão do leiaute usada no cabeçalho e nos namespaces */
  version: string;
}

function required(key: string): string {
  const value = process.env[key]?.trim().replace(/^"|"$/g, "");
  if (!value) throw new Error(`Variável de ambiente ausente: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return read(key) ?? fallback;
}

/** Valor da variável, ou `undefined` quando ausente — sem impor um padrão. */
function read(key: string): string | undefined {
  const value = process.env[key]?.trim().replace(/^"|"$/g, "");
  return value || undefined;
}

export function hostFor(environment: Environment, city: string): string {
  // O manual de Serviços Prestados v1.6 aponta `ws-homologacao`, mas esse host
  // só serve o portal (405 no POST). O ambiente SOAP ativo é o `-rtc`, citado
  // no Manual Técnico PIS/COFINS/CSLL v1.0.
  const host = environment === "homologacao" ? "ws-homologacao-rtc" : `ws-${city}`;
  return `https://${host}.giss.com.br`;
}

/**
 * Código IBGE do município, do ambiente ou da lista conhecida.
 *
 * Vive separado de `loadConfig` porque a tabela de atividades do portal só
 * precisa do município — exigir certificado e inscrição para uma consulta
 * pública seria pedir demais.
 */
export function resolveCityCode(
  city = optional("GISS_MUNICIPIO", "suzano"),
  code = read("GISS_CODIGO_MUNICIPIO"),
): string {
  const cityCode = code ?? findMunicipality(city)?.cityCode;
  if (!cityCode) {
    throw new Error(
      `Informe GISS_CODIGO_MUNICIPIO: "${city}" não está na lista de municípios conhecidos (veja MUNICIPALITIES)`,
    );
  }
  return cityCode;
}

export function loadConfig(overrides: Partial<GissConfig> = {}): GissConfig {
  const environment = (overrides.environment ??
    optional("GISS_ENV", "producao")) as Environment;
  if (environment !== "producao" && environment !== "homologacao") {
    throw new Error(`GISS_ENV inválido: ${environment} (use producao|homologacao)`);
  }

  const city = overrides.city ?? optional("GISS_MUNICIPIO", "suzano");

  // Errar o código IBGE é fácil e caro: ele identifica o município na nota.
  // Quando a cidade é uma das conhecidas, o código vem dela — antes, trocar
  // só `GISS_MUNICIPIO` deixava para trás o código de Suzano, e a nota saía
  // com o município errado sem nenhum aviso.
  const cityCode = overrides.cityCode ?? resolveCityCode(city);

  return {
    environment,
    city,
    host: overrides.host ?? hostFor(environment, city),
    certificatePath: resolve(overrides.certificatePath ?? required("CERT_PATH")),
    certificatePassword:
      overrides.certificatePassword ?? required("CERT_PASSWORD"),
    cnpj: digitsOnly(overrides.cnpj ?? required("GISS_CNPJ")),
    municipalRegistration:
      overrides.municipalRegistration ?? required("GISS_ISC_MUNICIPAL"),
    cityCode,
    version: overrides.version ?? optional("GISS_VERSAO", "2.04"),
  };
}

/** Credenciais do portal web — usadas só pela API REST de cadastro. */
export function loadPortalCredentials(
  config: Pick<GissConfig, "cityCode"> & Partial<Pick<GissConfig, "cnpj">>,
  overrides: { login?: string; password?: string } = {},
) {
  return {
    login: overrides.login ?? required("GISS_LOGIN"),
    password: overrides.password ?? required("GISS_PASS"),
    cityCode: config.cityCode,
    cnpj: config.cnpj,
  };
}
