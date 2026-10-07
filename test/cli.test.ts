import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PROVIDER_CNPJ, testPfx } from "./helpers.ts";

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


describe("CLI — fluxo offline com certificado de teste", () => {
  const cli = resolve("src/cli/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "nfse-cli-flow-"));
  writeFileSync(join(cwd, "cert.pfx"), testPfx("segredo"));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k))),
    CERT_PATH: "cert.pfx",
    CERT_PASSWORD: "segredo",
    GISS_CNPJ: PROVIDER_CNPJ,
    GISS_ISC_MUNICIPAL: "53624",
    GISS_AMBIENTE: "homologacao",
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

  it("cadastra o cliente localmente e lista", () => {
    const add = run("customer-add", "--tax-id", "52.884.617/0001-10", "--name", "Cliente Teste Ltda", "--alias", "teste");
    assert.equal(add.status, 0, add.stderr);
    const saved = JSON.parse(readFileSync(join(cwd, "data/contacts.json"), "utf8"));
    assert.equal(saved.customers[0].taxId, "52884617000110");
    assert.match(run("customers").stdout, /Cliente Teste Ltda/);
  });

  it("issue sem --confirm mostra o XML assinado e não envia nada", () => {
    const preview = run("issue", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--xml");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /^<\?xml[\s\S]*<GerarNfseEnvio/);
    assert.match(preview.stdout, /<tipos:Cnpj>52884617000110<\/tipos:Cnpj>/);
    assert.match(preview.stdout, /<SignatureValue>/);

    const summary = run("issue", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2");
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /Nothing was sent/);
  });

  it("issue sem alíquota falha antes do envio, com código VALIDATION", () => {
    const result = run("issue", "--customer", "teste", "--amount", "1500", "--description", "Software");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E163/);
    assert.match(result.stderr, /code: VALIDATION/);
  });

  it("cliente desconhecido não vira nota", () => {
    const result = run("issue", "--customer", "ninguem", "--amount", "10", "--description", "x", "--rate", "2");
    assert.equal(result.status, 1);
  });

  it("emissor nacional: prévia da DPS assinada em SHA-256", () => {
    const result = run("issue", "--issuer", "nacional", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--dps", "7", "--xml");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<DPS [^>]*xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse"/);
    assert.match(result.stdout, new RegExp(`Id="DPS35525022${PROVIDER_CNPJ}0000[0-9]{1}000000000000007"`));
    assert.match(result.stdout, /rsa-sha256/);
  });
});
