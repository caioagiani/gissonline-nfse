/** Construtores mínimos de XML — mantêm a ordem dos elementos, que os XSD exigem. */

export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

export type Fragmento = string | null | undefined | false;

type Atributos = Record<string, string | number | undefined>;

function atributos(attrs?: Atributos): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escaparXml(String(v))}"`)
    .join("");
}

/** Elemento simples. Devolve string vazia quando o valor é nulo/indefinido — o que omite campos opcionais. */
export function el(
  nome: string,
  valor: string | number | undefined | null,
  attrs?: Atributos,
): string {
  if (valor === undefined || valor === null || valor === "") return "";
  return `<${nome}${atributos(attrs)}>${escaparXml(String(valor))}</${nome}>`;
}

/** Elemento com filhos. Devolve string vazia quando nenhum filho tem conteúdo. */
export function grupo(
  nome: string,
  filhos: Fragmento[],
  attrs?: Atributos,
): string {
  const corpo = filhos.filter(Boolean).join("");
  if (!corpo) return "";
  return `<${nome}${atributos(attrs)}>${corpo}</${nome}>`;
}

/** Como `grupo`, mas mantém o elemento mesmo sem filhos (para grupos obrigatórios). */
export function grupoObrigatorio(
  nome: string,
  filhos: Fragmento[],
  attrs?: Atributos,
): string {
  return `<${nome}${atributos(attrs)}>${filhos.filter(Boolean).join("")}</${nome}>`;
}

export interface OpcoesDocumento {
  raiz: string;
  /** Namespace padrão do documento */
  xmlns: string;
  /** Prefixos adicionais, ex.: `{ tipos: "http://..." }` */
  prefixos?: Record<string, string>;
  corpo: Fragmento[];
  attrs?: Atributos;
}

export function documento({
  raiz,
  xmlns,
  prefixos = {},
  corpo,
  attrs,
}: OpcoesDocumento): string {
  const declaracoes = Object.entries(prefixos)
    .map(([prefixo, uri]) => ` xmlns:${prefixo}="${uri}"`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<${raiz} xmlns="${xmlns}"${declaracoes}${atributos(attrs)}>` +
    corpo.filter(Boolean).join("") +
    `</${raiz}>`
  );
}

/** Formata número no padrão dos XSD de valor: duas casas decimais, ponto como separador. */
export function valor(numero: number | string | undefined): string | undefined {
  if (numero === undefined || numero === null || numero === "") return undefined;
  return Number(numero).toFixed(2);
}

/**
 * Normaliza para `AAAA-MM-DD`, aceitando Date ou string já formatada.
 * Usa os componentes locais: `toISOString` converte para UTC e adiantaria o dia
 * à noite no horário de Brasília, o que mudaria a competência da nota.
 */
export function data(valor: Date | string): string {
  if (!(valor instanceof Date)) return valor.slice(0, 10);
  const mes = String(valor.getMonth() + 1).padStart(2, "0");
  const dia = String(valor.getDate()).padStart(2, "0");
  return `${valor.getFullYear()}-${mes}-${dia}`;
}

export const somenteDigitos = (valor: string): string => valor.replace(/\D/g, "");
