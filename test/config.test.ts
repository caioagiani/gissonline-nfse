import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig } from "../src/config/index.ts";
import { ConfigError } from "../src/domain/errors.ts";

const KEYS = ["NFSE_EMISSOR", "GISS_ENV", "GISS_MUNICIPIO", "GISS_CODIGO_MUNICIPIO"];
const base = {
  certificatePath: "cert/test.pfx",
  certificatePassword: "x",
  cnpj: "37.969.249/0001-10",
  municipalRegistration: "123",
};

describe("loadConfig — emissor", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("usa o GissOnline por padrão", () => {
    assert.equal(loadConfig(base).issuer, "giss");
  });

  it("lê NFSE_EMISSOR do ambiente", () => {
    process.env["NFSE_EMISSOR"] = "nacional";
    assert.equal(loadConfig(base).issuer, "nacional");
  });

  it("o override vence o ambiente", () => {
    process.env["NFSE_EMISSOR"] = "nacional";
    assert.equal(loadConfig({ ...base, issuer: "giss" }).issuer, "giss");
  });

  it("recusa valor desconhecido", () => {
    process.env["NFSE_EMISSOR"] = "sefin";
    assert.throws(
      () => loadConfig(base),
      (error: unknown) => error instanceof ConfigError && /NFSE_EMISSOR inválido: sefin/.test(error.message),
    );
  });

  it("mantém CNPJ só com dígitos e o município de Suzano", () => {
    const config = loadConfig(base);
    assert.equal(config.cnpj, "37969249000110");
    assert.equal(config.cityCode, "3552502");
  });
});

describe("loadConfig — erros de configuração", () => {
  it("ambiente inválido", () => {
    assert.throws(() => loadConfig({ ...base, environment: "teste" as never }), ConfigError);
  });

  it("variável obrigatória ausente diz qual é", () => {
    const saved = process.env["GISS_CNPJ"];
    delete process.env["GISS_CNPJ"];
    try {
      const { cnpj: _, ...withoutCnpj } = base;
      assert.throws(
        () => loadConfig(withoutCnpj),
        (error: unknown) => error instanceof ConfigError && /GISS_CNPJ/.test(error.message),
      );
    } finally {
      if (saved !== undefined) process.env["GISS_CNPJ"] = saved;
    }
  });
});

