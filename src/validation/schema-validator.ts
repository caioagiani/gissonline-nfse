import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Erros que vêm de divergência conhecida entre o XSD publicado e o serviço */
  knownDivergences: string[];
}

/**
 * Casos em que o XSD publicado contradiz o que o serviço aceita, confirmados
 * contra o comportamento real. Vazio hoje: o serviço valida o XSD ao pé da
 * letra e devolve E160 em qualquer desvio.
 */
const KNOWN_DIVERGENCES: RegExp[] = [];

/**
 * Valida um XML contra o XSD correspondente usando `xmllint`. Devolve `null`
 * quando o binário não está instalado — a validação é uma conferência extra,
 * não um requisito para enviar.
 */
export function validateAgainstSchema(
  xml: string,
  schema: string,
  schemaDirectory = "docs/schemas",
): ValidationResult | null {
  const available = spawnSync("xmllint", ["--version"], { stdio: "ignore" });
  if (available.error) return null;

  const folder = mkdtempSync(join(tmpdir(), "giss-"));
  const file = join(folder, "document.xml");
  writeFileSync(file, xml);

  const run = spawnSync(
    "xmllint",
    ["--noout", "--schema", resolve(schemaDirectory, schema), file],
    { encoding: "utf8" },
  );

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const all = output
    .split("\n")
    .filter((line) => line.includes("Schemas validity error"))
    .map((line) => line.replace(/^.*Schemas validity error : /, "").trim());

  const knownDivergences = all.filter((e) =>
    KNOWN_DIVERGENCES.some((pattern) => pattern.test(e)),
  );
  const errors = all.filter((e) => !knownDivergences.includes(e));

  return { valid: errors.length === 0, errors, knownDivergences };
}
