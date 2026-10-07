import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
