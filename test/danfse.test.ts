import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { ValidationError } from "../src/domain/errors.ts";
import { buildDanfseData, clip, danfseStatus } from "../src/providers/nacional/danfse/danfse-data.ts";
import { renderDanfse } from "../src/providers/nacional/danfse/danfse-pdf.ts";
import { ibgeMunicipality } from "../src/providers/nacional/danfse/ibge-municipalities.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const FULL = fixture("national-nfse-full.xml");
const MINIMAL = fixture("national-nfse.xml");

describe("DANFSe — campos tirados do XML (NT 008, item 2.4.5)", () => {
  const data = buildDanfseData(FULL);

  it("identificação: chave sem o prefixo NFS, datas DD/MM/AAAA e descrições dos códigos", () => {
    assert.equal(data.accessKey, "35525022237969249000110000000000060026100000000009");
    assert.equal(data.qrCodeUrl, `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${data.accessKey}`);
    assert.deepEqual(data.identification, {
      number: "600",
      competence: "06/10/2026",
      processedAt: "06/10/2026 10:15:30",
      dpsNumber: "600",
      dpsSeries: "1",
      dpsIssuedAt: "06/10/2026 10:15:00",
      issuer: "Prestador",
      status: "NFS-e de Substituição Gerada",
      purpose: "NFS-e regular",
    });
  });

  it("cabeçalho: município do emitente, ambiente e o aviso de homologação", () => {
    assert.deepEqual(data.header, {
      city: "Suzano / SP",
      generator: "Sistema Nacional da NFS-e",
      environment: "Homologação",
      testing: true,
    });
  });

  it("prestador emitente: dados de `emit`, já que a DPS não os repete", () => {
    assert.equal(data.provider.taxId, "37.969.249/0001-10");
    assert.equal(data.provider.name, "EMPRESA TESTE LTDA");
    assert.equal(data.provider.city, "Suzano / SP");
    assert.equal(data.provider.cityCodeZip, "3552502 / 08.675-000");
    assert.equal(data.provider.address, "Rua Teste, 10, Centro");
    assert.equal(data.provider.simplesNacional, "Optante - Microempresa ou Empresa de...");
  });

  it("tomador com CPF e município pelo código do IBGE", () => {
    assert.equal(data.taker?.taxId, "123.456.789-01");
    assert.equal(data.taker?.city, "Cachoeira do Sul / RS");
    assert.equal(data.taker?.address, "Rua Um, 1, Casa 2, Oliveira");
    assert.equal(data.taker?.municipalRegistration, "-");
  });

  it("indDest = 0: o destinatário é o próprio tomador; sem intermediário, bloco suprimido", () => {
    assert.equal(data.recipient, "taker");
    assert.equal(data.intermediary, undefined);
  });

  it("serviço: códigos com máscara e descrição", () => {
    assert.equal(data.service.taxCode, "01.04.01 / 002");
    assert.equal(data.service.nbs, "1.1502.10.00");
    assert.equal(data.service.location, "Suzano / SP / BR");
    assert.equal(data.service.description, "Desenvolvimento sob encomenda");
  });

  it("PIS/COFINS retidos (tpRetPisCofins = 1): somam nas retidas e zeram a apuração própria", () => {
    assert.equal(data.federalTax.socialContributions, "R$ 46,50");
    assert.equal(data.federalTax.pis, "R$ 0,00");
    assert.equal(data.federalTax.cofins, "R$ 0,00");
    assert.equal(data.federalTax.socialContributionsDescription, "PIS/COFINS Retidos");
    assert.equal(data.federalTax.showPisCofins, true);
  });

  it("IBS/CBS e totais", () => {
    assert.equal(data.ibsCbs.cstClassification, "000 / 000001");
    assert.equal(data.ibsCbs.operation, "100301 / 3552502 / Suzano / SP");
    assert.equal(data.ibsCbs.ibsRates, "0,10% / 0,00%");
    assert.equal(data.ibsCbs.cbsAmount, "R$ 8,45");
    assert.equal(data.ibsCbs.exclusions, "R$ 56,50");
    assert.equal(data.totals.ibsCbs, "R$ 9,39");
    assert.equal(data.totals.netWithIbsCbs, "R$ 963,89");
    assert.equal(data.municipalTax?.rate, "2,00%");
    assert.equal(data.municipalTax?.amount, "R$ 20,00");
  });

  it("informações complementares na ordem da NT, com os tributos aproximados por último", () => {
    assert.equal(
      data.additionalInformation,
      "Inf. Cont.: Pedido interno 42 | NFS-e Subst.: 35525022237969249000110000000000059926100000000001 | " +
        "Núm. Ped.: PC-7 | Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: " +
        "Federais: 4,65%; Estaduais: 0,00%; Municipais: 2,00%",
    );
  });

  it("nota mínima: o que falta vira '-', blocos sem dados são suprimidos", () => {
    const minimal = buildDanfseData(MINIMAL);
    assert.equal(minimal.identification.dpsNumber, "-");
    assert.equal(minimal.taker?.address, "-");
    assert.equal(minimal.recipient, undefined);
    assert.equal(minimal.municipalTax, undefined);
    assert.equal(minimal.ibsCbs.base, "-");
    assert.match(minimal.additionalInformation, /Federais: -; Estaduais: -; Municipais: -$/);
  });

  it("código de tributação do item 99 esconde o município do cabeçalho", () => {
    assert.equal(buildDanfseData(FULL.replace("<cTribNac>010401", "<cTribNac>990101")).header.city, "");
  });

  it("competência depois de 2026 não imprime a linha de PIS/COFINS (nota 6)", () => {
    const later = FULL.replace("<dCompet>2026-10-06", "<dCompet>2027-01-02");
    assert.equal(buildDanfseData(later).federalTax.showPisCofins, false);
  });

  it("XML que não é NFS-e nacional é recusado", () => {
    assert.throws(() => buildDanfseData("<CompNfse/>"), ValidationError);
  });

  it("reticências quando o texto passa do tamanho", () => {
    assert.equal(clip("abcdefghij", 8), "abcde...");
    assert.equal(clip("abc", 8), "abc");
  });

  it("municípios do IBGE", () => {
    assert.deepEqual(ibgeMunicipality("3552502"), { name: "Suzano", state: "SP" });
    assert.equal(ibgeMunicipality("0000000"), undefined);
  });
});

describe("DANFSe — marca d'água pelos eventos (item 2.5)", () => {
  it("substituição, cancelamento e eventos que não invalidam a nota", () => {
    assert.equal(danfseStatus([{ code: "105102" }]), "replaced");
    assert.equal(danfseStatus([{ code: "101101" }]), "cancelled");
    assert.equal(danfseStatus([{ code: "105104" }]), "cancelled");
    assert.equal(danfseStatus([{ code: "305101" }]), "cancelled");
    assert.equal(danfseStatus([{ code: "101103" }, { code: "202201" }]), undefined);
    assert.equal(danfseStatus([]), undefined);
  });
});

describe("DANFSe — PDF", () => {
  it("uma página A4, retrato, com título e chave nos metadados", async () => {
    const pdf = await PDFDocument.load(await renderDanfse(FULL));
    assert.equal(pdf.getPageCount(), 1);
    const { width, height } = pdf.getPage(0).getSize();
    assert.equal(Math.round(width), 595);
    assert.equal(Math.round(height), 842);
    assert.equal(pdf.getTitle(), "DANFSe 600");
    assert.match(pdf.getSubject() ?? "", /35525022237969249000110000000000060026100000000009/);
  });

  it("emoji e texto enorme não quebram e continuam em uma página", async () => {
    const long = FULL.replace(
      "<xDescServ>Desenvolvimento sob encomenda</xDescServ>",
      `<xDescServ>${"Serviço 😀 com descrição longa ".repeat(60)}</xDescServ>`,
    ).replace("<xInfComp>Pedido interno 42</xInfComp>", `<xInfComp>${"informação ".repeat(250)}</xInfComp>`);
    const pdf = await PDFDocument.load(await renderDanfse(long, { status: "cancelled" }));
    assert.equal(pdf.getPageCount(), 1);
  });

  it("nota mínima e todas as marcas d'água", async () => {
    for (const status of [undefined, "cancelled", "replaced"] as const) {
      const pdf = await PDFDocument.load(await renderDanfse(MINIMAL, { status }));
      assert.equal(pdf.getPageCount(), 1);
    }
  });
});
