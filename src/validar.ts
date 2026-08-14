import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface ResultadoValidacao {
  valido: boolean;
  erros: string[];
}

/**
 * Valida um XML contra o XSD correspondente usando `xmllint`. Devolve `null`
 * quando o binário não está instalado — a validação é uma conferência extra,
 * não um requisito para enviar.
 */
export function validarContraXsd(
  xml: string,
  schema: string,
  diretorioSchemas = "docs/schemas",
): ResultadoValidacao | null {
  const disponivel = spawnSync("xmllint", ["--version"], { stdio: "ignore" });
  if (disponivel.error) return null;

  const pasta = mkdtempSync(join(tmpdir(), "giss-"));
  const arquivo = join(pasta, "documento.xml");
  writeFileSync(arquivo, xml);

  const execucao = spawnSync(
    "xmllint",
    ["--noout", "--schema", resolve(diretorioSchemas, schema), arquivo],
    { encoding: "utf8" },
  );

  const saida = `${execucao.stdout ?? ""}${execucao.stderr ?? ""}`;
  const erros = saida
    .split("\n")
    .filter((linha) => linha.includes("Schemas validity error"))
    .map((linha) => linha.replace(/^.*Schemas validity error : /, "").trim());

  return { valido: execucao.status === 0, erros };
}
