// Audita só o que quem instala o pacote recebe: as dependências de runtime.
// `npm audit --omit=dev` não serve — reporta pacotes embutidos em ferramentas
// de desenvolvimento. Aqui um lockfile é gerado só com `dependencies`, e o
// build falha com qualquer alerta alto ou crítico fora da lista abaixo.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Alertas avaliados e que não atingem a biblioteca. Cada um com o motivo —
 * revisar quando o pacote ganhar correção.
 */
const ACCEPTED = {
  // node-forge: verificação de assinatura RSA PKCS#1 v1.5. A biblioteca só usa
  // o forge para abrir o .pfx (PKCS#12, senha conferida por HMAC); nunca
  // verifica assinatura RSA com ele. Sem versão corrigida publicada.
  "GHSA-86w9-cpqp-85rv": "node-forge: RSA signature verification is never called",
};

const BLOCKING = new Set(["high", "critical"]);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const folder = mkdtempSync(join(tmpdir(), "nfse-audit-"));
try {
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: pkg.dependencies }),
  );
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: folder,
    stdio: "ignore",
  });

  let output;
  try {
    output = execFileSync("npm", ["audit", "--json"], { cwd: folder, encoding: "utf8" });
  } catch (error) {
    // npm audit sai com código 1 quando encontra algo; o JSON vem mesmo assim.
    output = error.stdout;
  }
  const report = JSON.parse(output);

  const findings = Object.values(report.vulnerabilities ?? {}).flatMap((vulnerability) =>
    vulnerability.via
      .filter((via) => typeof via === "object")
      .map((via) => ({
        id: via.url?.split("/").pop() ?? via.source,
        name: via.name,
        severity: via.severity,
        title: via.title,
      })),
  );

  const blocking = findings.filter((f) => BLOCKING.has(f.severity) && !(f.id in ACCEPTED));
  for (const f of findings) {
    const status = f.id in ACCEPTED ? "accepted" : BLOCKING.has(f.severity) ? "BLOCKING" : "low";
    console.log(`${status.padEnd(8)} ${f.severity.padEnd(8)} ${f.name} ${f.id} — ${f.title}`);
    if (f.id in ACCEPTED) console.log(`         ${ACCEPTED[f.id]}`);
  }
  console.log(`\n${findings.length} finding(s) in runtime dependencies, ${blocking.length} blocking.`);
  if (blocking.length > 0) process.exitCode = 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
