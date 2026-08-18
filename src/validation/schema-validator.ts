import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Os XSD são distribuídos junto com o pacote. Resolvidos a partir do módulo,
 * funcionam tanto rodando do repositório quanto instalados em node_modules;
 * um diretório passado explicitamente sempre tem precedência.
 */
function resolveSchemaDirectory(directory: string): string {
  const fromCwd = resolve(directory);
  if (existsSync(fromCwd)) return fromCwd;

  const here = dirname(fileURLToPath(import.meta.url));
  for (const base of [join(here, "..", ".."), join(here, "..", "..", "..")]) {
    const candidate = resolve(base, directory);
    if (existsSync(candidate)) return candidate;
  }
  return fromCwd;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Erros que vêm de divergência conhecida entre o XSD publicado e o serviço */
  knownDivergences: string[];
}

/**
 * Casos em que o XSD publicado contradiz o que o serviço realmente aceita —
 * confirmados contra notas emitidas de verdade.
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
    ["--noout", "--schema", join(resolveSchemaDirectory(schemaDirectory), schema), file],
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
