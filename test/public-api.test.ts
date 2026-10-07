import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "../src/index.ts";

describe("API pública", () => {
  it("mantém GissClient como apelido de NfseClient", () => {
    assert.equal(api.GissClient, api.NfseClient);
  });

  it("expõe os dois provedores e os diretórios de schema", () => {
    assert.equal(typeof api.NfseService, "function");
    assert.equal(typeof api.NationalService, "function");
    assert.deepEqual(Object.keys(api.SCHEMA_DIRECTORIES).sort(), [
      "gissProvided",
      "gissTaken",
      "national",
    ]);
  });

  it("expõe todas as classes de erro, derivadas de NfseError", () => {
    for (const name of [
      "CertificateError",
      "ConfigError",
      "GissError",
      "NationalError",
      "NotSupportedError",
      "PortalError",
      "SoapFaultError",
      "TransportError",
      "ValidationError",
    ] as const) {
      assert.ok(api[name].prototype instanceof api.NfseError, name);
    }
  });
});
