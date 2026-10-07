import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { NotSupportedError, ValidationError } from "../src/domain/errors.ts";
import {
  brasiliaDateTime,
  buildCancellationEvent,
  buildDps,
  dpsId,
  nationalTaxCode,
  parseNationalNfse,
  type DpsContext,
} from "../src/providers/nacional/messages.ts";
import { PROVIDER_CNPJ, SUZANO, sampleRps } from "./helpers.ts";

const context: DpsContext = {
  environment: 2,
  cnpj: PROVIDER_CNPJ,
  cityCode: SUZANO,
  series: "1",
  number: "7",
  simplesOption: 3,
  issueDate: new Date("2026-10-06T15:00:00Z"),
};

/** Conteúdo de uma tag, ou `undefined` quando ela não aparece. */
const tag = (xml: string, name: string) =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe("dpsId", () => {
  it("monta DPS + município + tipo + CNPJ + série + número com 45 caracteres", () => {
    const id = dpsId(context);
    assert.equal(id, "DPS355250223796924900011000001000000000000007");
    assert.equal(id.length, 45);
  });

  it("aceita CNPJ formatado", () => {
    assert.equal(dpsId({ ...context, cnpj: "37.969.249/0001-10" }), dpsId(context));
  });
});

describe("nationalTaxCode", () => {
  it("completa o desdobramento quando o item vem só com subitem", () => {
    assert.equal(nationalTaxCode("01.09"), "010901");
    assert.equal(nationalTaxCode("1.9"), "010901");
  });

  it("mantém o desdobramento informado", () => {
    assert.equal(nationalTaxCode("17.01.02"), "170102");
  });

  it("recusa o que não vira seis dígitos", () => {
    assert.throws(() => nationalTaxCode("abc"), /cTribNac/);
    assert.throws(() => nationalTaxCode("01.09.01.01"), /cTribNac/);
  });
});

describe("brasiliaDateTime", () => {
  it("usa o fuso -03:00 e recua um minuto", () => {
    assert.equal(
      brasiliaDateTime(new Date("2026-10-06T15:00:30Z")),
      "2026-10-06T11:59:30-03:00",
    );
  });
});

describe("buildDps", () => {
  const xml = buildDps(sampleRps(), context);

  it("declara namespace e versão do leiaute nacional", () => {
    assert.match(xml, /<DPS xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse" versao="1\.01">/);
    assert.match(xml, /<infDPS Id="DPS355250223796924900011000001000000000000007">/);
  });

  it("preenche a identificação da declaração", () => {
    assert.equal(tag(xml, "tpAmb"), "2");
    assert.equal(tag(xml, "dhEmi"), "2026-10-06T11:59:00-03:00");
    assert.equal(tag(xml, "serie"), "1");
    assert.equal(tag(xml, "nDPS"), "7");
    assert.equal(tag(xml, "dCompet"), "2026-10-06");
    assert.equal(tag(xml, "tpEmit"), "1");
    assert.equal(tag(xml, "cLocEmi"), SUZANO);
  });

  it("identifica o prestador só pelo CNPJ e pelo regime", () => {
    const prest = /<prest>.*<\/prest>/.exec(xml)?.[0] ?? "";
    assert.equal(tag(prest, "CNPJ"), PROVIDER_CNPJ);
    assert.doesNotMatch(prest, /<IM>/);
    assert.equal(tag(prest, "opSimpNac"), "3");
    assert.equal(tag(prest, "regApTribSN"), "1");
    assert.equal(tag(prest, "regEspTrib"), "0");
  });

  it("leva tomador com documento só em dígitos, endereço e contato", () => {
    const toma = /<toma>.*<\/toma>/.exec(xml)?.[0] ?? "";
    assert.equal(tag(toma, "CNPJ"), "52884617000110");
    assert.equal(tag(toma, "xNome"), "Cliente &amp; Filhos Ltda");
    assert.equal(tag(toma, "cMun"), SUZANO);
    assert.equal(tag(toma, "CEP"), "08675000");
    assert.equal(tag(toma, "fone"), "1144445555");
    assert.equal(tag(toma, "email"), "fin@cliente.com.br");
  });

  it("usa CPF quando o tomador não tem CNPJ", () => {
    const rps = sampleRps({ taker: { cpf: "123.456.789-09", legalName: "Pessoa" } });
    const toma = /<toma>.*<\/toma>/.exec(buildDps(rps, context))?.[0] ?? "";
    assert.equal(tag(toma, "CPF"), "12345678909");
    assert.doesNotMatch(toma, /<CNPJ>/);
  });

  it("converte o item da LC 116 e leva NBS e descrição", () => {
    assert.equal(tag(xml, "cLocPrestacao"), SUZANO);
    assert.equal(tag(xml, "cTribNac"), "010401");
    assert.equal(tag(xml, "cNBS"), "115021000");
    assert.equal(tag(xml, "xDescServ"), "Desenvolvimento de software");
  });

  it("ME/EPP apurando pelo Simples não destaca alíquota", () => {
    assert.equal(tag(xml, "vServ"), "1500.00");
    assert.equal(tag(xml, "tribISSQN"), "1");
    assert.equal(tag(xml, "tpRetISSQN"), "1");
    assert.doesNotMatch(xml, /<pAliq>/);
  });

  it("não optante leva a alíquota do perfil", () => {
    const other = buildDps(sampleRps(), { ...context, simplesOption: 1 });
    assert.equal(tag(other, "pAliq"), "3.07");
    assert.doesNotMatch(other, /<regApTribSN>/);
  });

  it("ME/EPP com apuração fora do Simples leva a alíquota", () => {
    const other = buildDps(sampleRps(), { ...context, simplesApportionment: 2 });
    assert.equal(tag(other, "regApTribSN"), "2");
    assert.equal(tag(other, "pAliq"), "3.07");
  });

  it("ISS retido pelo tomador vira tpRetISSQN 2", () => {
    const withheld = sampleRps({ profile: { issWithheld: 1 } });
    assert.equal(tag(buildDps(withheld, context), "tpRetISSQN"), "2");
  });

  it("traduz a exigibilidade do ABRASF", () => {
    const of = (issTaxability: number) =>
      tag(buildDps(sampleRps({ profile: { issTaxability } }), context), "tribISSQN");
    assert.equal(of(2), "4"); // não incidência
    assert.equal(of(4), "3"); // exportação
    assert.equal(of(5), "2"); // imunidade
  });

  it("recusa exigibilidade sem equivalente nacional", () => {
    const rps = sampleRps({ profile: { issTaxability: 3 } });
    assert.throws(() => buildDps(rps, context), /Exigibilidade 3/);
  });

  it("omite retenções e descontos zerados", () => {
    assert.doesNotMatch(xml, /<tribFed>/);
    assert.doesNotMatch(xml, /<vDescCondIncond>/);
    assert.doesNotMatch(xml, /<infoCompl>/);
  });

  it("leva retenções, descontos e informação complementar quando há valor", () => {
    const full = buildDps(
      sampleRps({
        inss: 10,
        incomeTax: 22.5,
        csll: 69.75,
        unconditionalDiscount: 5,
        additionalInformation: "Pedido 42",
      }),
      context,
    );
    assert.equal(tag(full, "vRetCP"), "10.00");
    assert.equal(tag(full, "vRetIRRF"), "22.50");
    assert.equal(tag(full, "vRetCSLL"), "69.75");
    assert.equal(tag(full, "vDescIncond"), "5.00");
    assert.doesNotMatch(full, /<vDescCond>/);
    assert.equal(tag(full, "xInfComp"), "Pedido 42");
  });

  it("totTrib: percentual do Simples quando houver, senão indTotTrib 0", () => {
    assert.equal(tag(xml, "indTotTrib"), "0");
    const withRate = sampleRps({
      profile: { approximateTaxes: { simplesNacional: 6 } },
    });
    const other = buildDps(withRate, context);
    assert.equal(tag(other, "pTotTribSN"), "6.00");
    assert.doesNotMatch(other, /<indTotTrib>/);
    // não optante nunca usa o percentual do Simples
    assert.equal(tag(buildDps(withRate, { ...context, simplesOption: 1 }), "indTotTrib"), "0");
  });

  it("traduz o regime especial do ABRASF", () => {
    const of = (specialTaxRegime: number) =>
      tag(buildDps(sampleRps({ profile: { specialTaxRegime } }), context), "regEspTrib");
    assert.equal(of(1), "3");
    assert.equal(of(4), "1");
    assert.equal(of(6), "0");
  });
});

describe("buildCancellationEvent", () => {
  const accessKey = "35525021237969249000110000000000058026090101823674";
  const input = {
    environment: 1 as const,
    cnpj: PROVIDER_CNPJ,
    accessKey,
    reason: 1 as const,
    justification: "  Valor informado errado  ",
    eventDate: new Date("2026-10-06T15:00:00Z"),
  };

  it("monta o pedido do evento 101101", () => {
    const xml = buildCancellationEvent(input);
    assert.match(xml, new RegExp(`<infPedReg Id="PRE${accessKey}101101">`));
    assert.equal(`PRE${accessKey}101101`.length, 59);
    assert.equal(tag(xml, "tpAmb"), "1");
    assert.equal(tag(xml, "CNPJAutor"), PROVIDER_CNPJ);
    assert.equal(tag(xml, "chNFSe"), accessKey);
    assert.equal(tag(xml, "xDesc"), "Cancelamento de NFS-e");
    assert.equal(tag(xml, "cMotivo"), "1");
    assert.equal(tag(xml, "xMotivo"), "Valor informado errado");
  });

  it("exige justificativa de 15 a 255 caracteres", () => {
    assert.throws(() => buildCancellationEvent({ ...input, justification: "curta" }), /15 a 255/);
    assert.throws(
      () => buildCancellationEvent({ ...input, justification: "x".repeat(256) }),
      /15 a 255/,
    );
    assert.doesNotThrow(() => buildCancellationEvent({ ...input, justification: "x".repeat(255) }));
  });
});

describe("parseNationalNfse", () => {
  const xml = readFileSync(new URL("./fixtures/national-nfse.xml", import.meta.url), "utf8");
  const nfse = parseNationalNfse(xml);

  it("lê chave, número e situação", () => {
    assert.equal(nfse.accessKey, "35525021237969249000110000000000058126100000000001");
    assert.equal(nfse.number, "581");
    assert.equal(nfse.documentNumber, "12345");
    assert.equal(nfse.status, "100");
    assert.equal(nfse.processedAt, "2026-10-06T10:00:00-03:00");
    assert.equal(nfse.competence, "2026-10-06");
    assert.equal(nfse.issuingCity, "SUZANO");
  });

  it("separa emitente de tomador", () => {
    assert.equal(nfse.issuerCnpj, PROVIDER_CNPJ);
    assert.equal(nfse.issuerName, "EMPRESA TESTE LTDA");
    assert.equal(nfse.takerTaxId, "52884617000110");
    assert.equal(nfse.takerName, "Cliente & Filhos Ltda");
  });

  it("converte valores para número", () => {
    assert.equal(nfse.serviceAmount, 1500);
    assert.equal(nfse.netAmount, 1500);
    assert.equal(nfse.description, "Desenvolvimento de software");
    assert.equal(nfse.xml, xml);
  });

  it("não quebra com XML sem os campos", () => {
    const empty = parseNationalNfse("<NFSe/>");
    assert.equal(empty.accessKey, "");
    assert.equal(empty.number, undefined);
    assert.equal(empty.serviceAmount, undefined);
  });
});

describe("buildDps — o que ainda não é suportado", () => {
  const unsupported: [string, Parameters<typeof sampleRps>[0], RegExp][] = [
    ["tomador com NIF", { taker: { nif: "123", legalName: "Acme" } }, /tomador no exterior/],
    [
      "tomador com endereço no exterior",
      {
        taker: {
          legalName: "Acme",
          foreignAddress: { countryCode: "0840", fullAddress: "100 Main St" },
        } as never,
      },
      /tomador no exterior/,
    ],
  ];
  for (const [name, input, pattern] of unsupported) {
    it(`${name}: NotSupportedError`, () => {
      assert.throws(
        () => buildDps(sampleRps(input), context),
        (error: unknown) => error instanceof NotSupportedError && pattern.test(error.message),
      );
    });
  }

  it("intermediário, obra, substituição e comExt também", () => {
    const base = sampleRps();
    const cases = [
      { ...base, intermediary: { legalName: "X", cnpj: "1", cityCode: SUZANO } },
      { ...base, construction: { workCode: "1" } },
      { ...base, replacedRps: { number: 1, series: "A" } },
      { ...base, service: { ...base.service, foreignTrade: {} as never } },
    ];
    for (const rps of cases) {
      assert.throws(() => buildDps(rps, context), NotSupportedError);
    }
  });

  it("lista tudo o que falta de uma vez", () => {
    const base = sampleRps({ taker: { nif: "1", legalName: "Acme" } });
    assert.throws(
      () => buildDps({ ...base, construction: { workCode: "1" } }, context),
      (error: unknown) =>
        error instanceof NotSupportedError &&
        Array.isArray(error.details["unsupported"]) &&
        (error.details["unsupported"] as string[]).length === 2,
    );
  });

  it("erros de entrada são ValidationError", () => {
    assert.throws(() => nationalTaxCode("x"), ValidationError);
  });
});

