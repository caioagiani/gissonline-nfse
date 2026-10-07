import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

describe("CLI", () => {
  it("lista os comandos e a opção do emissor nacional na ajuda", () => {
    const run = spawnSync(process.execPath, ["src/cli/index.ts", "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    for (const command of ["national-status", "national-get", "national-pdf", "national-xml", "national-docs"]) {
      assert.match(run.stdout, new RegExp(`\\b${command}\\b`));
    }
    assert.match(run.stdout, /--issuer giss\|nacional/);
  });
});

describe("CLI — erros", () => {
  const cli = resolve("src/cli/index.ts");
  /** Diretório sem .env e ambiente sem as variáveis do projeto. */
  const run = (...args: string[]) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k)),
    );
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: mkdtempSync(join(tmpdir(), "nfse-cli-")),
      env,
      encoding: "utf8",
    });
  };

  it("configuração ausente: código CONFIG e próximo passo, saída 1", () => {
    const result = run("latest");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Variável de ambiente ausente: CERT_PATH/);
    assert.match(result.stderr, /code: CONFIG/);
    assert.match(result.stderr, /Check \.env/);
  });

  it("certificado inexistente: código CERTIFICATE", () => {
    const env = { CERT_PATH: "/nao/existe.pfx", CERT_PASSWORD: "x", GISS_CNPJ: "1", GISS_ISC_MUNICIPAL: "1" };
    const withCert = spawnSync(process.execPath, [cli, "latest"], {
      cwd: mkdtempSync(join(tmpdir(), "nfse-cli-")),
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(withCert.status, 1);
    assert.match(withCert.stderr, /Não foi possível ler o certificado/);
    assert.match(withCert.stderr, /code: CERTIFICATE/);
  });
});

