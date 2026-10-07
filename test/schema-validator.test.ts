import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { buildDps, buildCancellationEvent } from "../src/providers/nacional/messages.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { validateAgainstSchema } from "../src/validation/schema-validator.ts";
import { PROVIDER_CNPJ, SUZANO, sampleRps, testCertificate } from "./helpers.ts";

const hasXmllint = !spawnSync("xmllint", ["--version"], { stdio: "ignore" }).error;
const NATIONAL = "docs/schemas-nacional";

const context = {
  environment: 2 as const,
  cnpj: PROVIDER_CNPJ,
  cityCode: SUZANO,
  series: "1",
  number: "7",
  simplesOption: 3 as const,
};

function signed(xml: string, reference: string, id: string): string {
  return createXmlSigner(testCertificate(), "sha256").sign(xml, {
    referenceXPath: `//*[local-name(.)='${reference}']`,
    id,
    targetXPath: "/*",
  });
}

describe("XSD nacional v1.01", { skip: !hasXmllint && "xmllint não instalado" }, () => {
  it("a DPS assinada é válida, salvo o bug conhecido de `serie`", () => {
    const xml = signed(buildDps(sampleRps(), context), "infDPS", "DPS355250223796924900011000001000000000000007");
    const result = validateAgainstSchema(xml, "DPS_v1.01.xsd", NATIONAL);
    assert.ok(result);
    assert.deepEqual(result.errors, []);
    assert.equal(result.knownDivergences.length, 1);
    assert.match(result.knownDivergences[0]!, /serie/);
  });

  it("a DPS com todos os grupos opcionais também é válida", () => {
    const rps = sampleRps({
      inss: 10,
      incomeTax: 22.5,
      csll: 69.75,
      unconditionalDiscount: 5,
      conditionalDiscount: 1,
      additionalInformation: "Pedido 42",
      profile: { approximateTaxes: { simplesNacional: 6 } },
    });
    const xml = signed(buildDps(rps, context), "infDPS", "DPS355250223796924900011000001000000000000007");
    assert.deepEqual(validateAgainstSchema(xml, "DPS_v1.01.xsd", NATIONAL)?.errors, []);
  });

  it("não optante, com alíquota e tomador por CPF, é válida", () => {
    const rps = sampleRps({ taker: { cpf: "12345678909", legalName: "Pessoa Física" } });
    const xml = signed(
      buildDps(rps, { ...context, simplesOption: 1 }),
      "infDPS",
      "DPS355250223796924900011000001000000000000007",
    );
    assert.deepEqual(validateAgainstSchema(xml, "DPS_v1.01.xsd", NATIONAL)?.errors, []);
  });

  it("o pedido de cancelamento é válido", () => {
    const key = "35525021237969249000110000000000058026090101823674";
    const event = buildCancellationEvent({
      environment: 2,
      cnpj: PROVIDER_CNPJ,
      accessKey: key,
      reason: 1,
      justification: "Valor informado errado",
    });
    const xml = signed(event, "infPedReg", `PRE${key}101101`);
    const result = validateAgainstSchema(xml, "pedRegEvento_v1.01.xsd", NATIONAL);
    assert.deepEqual(result?.errors, []);
    assert.deepEqual(result?.knownDivergences, []);
  });

  it("um erro real continua sendo erro", () => {
    const xml = buildDps(sampleRps(), context).replace("<tpAmb>2</tpAmb>", "<tpAmb>9</tpAmb>");
    const result = validateAgainstSchema(xml, "DPS_v1.01.xsd", NATIONAL);
    assert.equal(result?.valid, false);
    assert.ok(result?.errors.some((e) => e.includes("tpAmb")));
  });
});
