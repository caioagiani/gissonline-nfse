/** Construtores mínimos de XML — mantêm a ordem dos elementos, que os XSD exigem. */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

export type Fragment = string | null | undefined | false;

type Attributes = Record<string, string | number | undefined>;

function renderAttributes(attributes?: Attributes): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
}

/** Elemento simples. String vazia quando o valor é nulo — o que omite campos opcionais. */
export function element(
  name: string,
  value: string | number | undefined | null,
  attributes?: Attributes,
): string {
  if (value === undefined || value === null || value === "") return "";
  return `<${name}${renderAttributes(attributes)}>${escapeXml(String(value))}</${name}>`;
}

/** Elemento com filhos. String vazia quando nenhum filho tem conteúdo. */
export function group(
  name: string,
  children: Fragment[],
  attributes?: Attributes,
): string {
  const body = children.filter(Boolean).join("");
  if (!body) return "";
  return `<${name}${renderAttributes(attributes)}>${body}</${name}>`;
}

/** Como `group`, mas mantém o elemento mesmo sem filhos (para grupos obrigatórios). */
export function requiredGroup(
  name: string,
  children: Fragment[],
  attributes?: Attributes,
): string {
  return `<${name}${renderAttributes(attributes)}>${children.filter(Boolean).join("")}</${name}>`;
}

export interface DocumentOptions {
  root: string;
  /** Namespace padrão do documento */
  xmlns: string;
  /** Prefixos adicionais, ex.: `{ tipos: "http://..." }` */
  prefixes?: Record<string, string>;
  body: Fragment[];
  attributes?: Attributes;
}

export function xmlDocument({
  root,
  xmlns,
  prefixes = {},
  body,
  attributes,
}: DocumentOptions): string {
  const declarations = Object.entries(prefixes)
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<${root} xmlns="${xmlns}"${declarations}${renderAttributes(attributes)}>` +
    body.filter(Boolean).join("") +
    `</${root}>`
  );
}

/** Formata no padrão dos XSD de valor: duas casas decimais, ponto como separador. */
export function amount(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value).toFixed(2);
}

/**
 * Normaliza para `AAAA-MM-DD`, aceitando Date ou string já formatada.
 * Usa os componentes locais: `toISOString` converte para UTC e adiantaria o dia
 * à noite no horário de Brasília, o que mudaria a competência da nota.
 */
export function isoDate(value: Date | string): string {
  if (!(value instanceof Date)) return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

export const digitsOnly = (value: string): string => value.replace(/\D/g, "");
