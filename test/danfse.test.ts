import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
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
    assert.deepEqual(data.header, { city: "Suzano - SP", generator: "2", environment: "2", testing: true });
  });

  it("prestador emitente: dados de `emit`, já que a DPS não os repete", () => {
    assert.equal(data.provider.taxId, "37.969.249/0001-10");
    assert.equal(data.provider.name, "EMPRESA TESTE LTDA");
    assert.equal(data.provider.city, "Suzano / SP");
    assert.equal(data.provider.cityCodeZip, "35.52502 / 08.675-000");
    // Telefone e e-mail só os da DPS: o oficial não puxa os de `emit`.
    assert.equal(data.provider.phone, "-");
    assert.equal(data.provider.email, "-");
    assert.equal(data.provider.address, "Rua Teste, 10, Centro");
    assert.equal(data.provider.simplesNacional, "Optante - Microempresa ou Empresa de ...");
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
    assert.equal(data.service.location, "Suzano / SP / -");
    assert.equal(data.service.description, "Desenvolvimento sob encomenda");
  });

  it("PIS/COFINS retidos (tpRetPisCofins = 1): somam nas retidas e zeram a apuração própria", () => {
    assert.equal(data.federalTax.socialContributions, "R$ 46,50");
    assert.equal(data.federalTax.pis, "R$ 0,00");
    assert.equal(data.federalTax.cofins, "R$ 0,00");
    assert.equal(data.federalTax.socialContributionsDescription, "1 - PIS/COFINS Retidos");
    assert.equal(data.federalTax.showPisCofins, true);
  });

  it("IBS/CBS e totais", () => {
    assert.equal(data.ibsCbs.cstClassification, "000 / 000001");
    assert.equal(data.ibsCbs.operation, "100301 / 3552502 / Suzano / SP");
    assert.equal(data.ibsCbs.ibsRates, "0,10 % / 0,00 %");
    assert.equal(data.ibsCbs.cbsAmount, "R$ 8,45");
    assert.equal(data.ibsCbs.exclusions, "R$ 56,50");
    assert.equal(data.totals.ibsCbs, "R$ 9,39");
    assert.equal(data.totals.netWithIbsCbs, "R$ 963,89");
    assert.equal(data.municipalTax?.rate, "2,00 %");
    assert.equal(data.municipalTax?.amount, "R$ 20,00");
  });

  it("informações complementares na ordem da NT, com os tributos aproximados por último", () => {
    assert.equal(
      data.additionalInformation,
      "Inf. Cont.: Pedido interno 42 | NFS-e Subst.: 35525022237969249000110000000000059926100000000001 | " +
        "Núm. Ped.: PC-7 | Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: " +
        "Federais: 4,65 %; Estaduais: 0,00 %; Municipais: 2,00 %;",
    );
  });

  it("nota mínima: o que falta vira '-', blocos sem dados são suprimidos", () => {
    const minimal = buildDanfseData(MINIMAL);
    assert.equal(minimal.identification.dpsNumber, "-");
    assert.equal(minimal.taker?.address, "-");
    assert.equal(minimal.recipient, undefined);
    assert.equal(minimal.municipalTax, undefined);
    assert.equal(minimal.ibsCbs.base, "-");
    // Sem IBSCBS o oficial imprime R$ 0,00 nestes três.
    assert.equal(minimal.ibsCbs.exclusions, "R$ 0,00");
    assert.equal(minimal.totals.ibsCbs, "R$ 0,00");
    assert.equal(minimal.totals.netWithIbsCbs, "R$ 0,00");
    assert.equal(minimal.ibsCbs.cstClassification, "- / -");
    assert.equal(minimal.ibsCbs.rateReductions, "- / - / -");
    assert.equal(minimal.service.taxCode, "01.09.01 / -");
    assert.match(minimal.additionalInformation, /Federais: -; Estaduais: -; Municipais: -;$/);
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

describe("DANFSe — conferido com os DANFSe que o Emissor Nacional gera para MEI", () => {
  const mei = buildDanfseData(fixture("national-nfse-mei.xml"));

  it("cabeçalho com códigos de ambiente e 'Município - UF'", () => {
    assert.deepEqual(mei.header, { city: "São Paulo - SP", generator: "2", environment: "1", testing: false });
    assert.equal(mei.identification.status, "NFS-e MEI");
    assert.equal(mei.identification.dpsSeries, "70000");
  });

  it("MEI: situação no Simples e telefone com máscara", () => {
    assert.equal(mei.provider.simplesNacional, "Optante - Microempreendedor Individua...");
    assert.equal(mei.provider.simplesRegime, "-");
    assert.equal(mei.provider.phone, "(11) 98765-4321");
    assert.equal(mei.taker?.city, "Barueri / SP");
  });

  it("partes que faltam viram '-' dentro dos campos compostos", () => {
    assert.equal(mei.service.taxCode, "15.18.02 / -");
    assert.equal(mei.service.nbs, "1.1806.40.00");
    assert.equal(mei.service.location, "São Paulo / SP / -");
    assert.equal(mei.ibsCbs.operation, "- / - / - / -");
    assert.equal(mei.ibsCbs.ibsRates, "- / -");
  });

  it("quebras de linha da descrição são mantidas, inclusive vindas como &#13;&#10;", () => {
    assert.equal(
      mei.service.description,
      "Serviços prestados como assistente referente ao mês de setembro de 2026.\nDados bancários:\nBanco 0260.\nAgencia 0001 - Conta 12345-6\nPIX: chave-teste",
    );
  });

  it("linhas opcionais do ISSQN somem quando estão vazias (nota 5)", () => {
    assert.equal(mei.municipalTax?.showRegimeRow, false);
    assert.equal(mei.municipalTax?.showBenefitRow, false);
    // Regime especial "Nenhum" (0) também some, como no oficial.
    const full = buildDanfseData(FULL);
    assert.equal(full.municipalTax?.showRegimeRow, false);
    const special = buildDanfseData(FULL.replace("<regEspTrib>0</regEspTrib>", "<regEspTrib>6</regEspTrib>"));
    assert.equal(special.municipalTax?.showRegimeRow, true);
    assert.equal(special.municipalTax?.specialRegime, "Sociedade de Profissionais");
    assert.equal(full.municipalTax?.showBenefitRow, false);
  });

  it("gera em uma página", async () => {
    const pdf = await PDFDocument.load(await renderDanfse(fixture("national-nfse-mei.xml")));
    assert.equal(pdf.getPageCount(), 1);
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

  it("fontes embutidas (Liberation Sans), não as padrão do leitor", async () => {
    const pdf = await PDFDocument.load(await renderDanfse(FULL));
    const fontFiles = pdf.context
      .enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFDict && object.has(PDFName.of("FontFile2")));
    assert.equal(fontFiles.length, 2);
  });

  it("marca d'água a partir do XML dos eventos, sem rede", async () => {
    // A marca d'água é o único desenho com transparência (um ExtGState).
    // Comparar tamanhos não serve: o nome da fonte subset leva um sufixo aleatório.
    const hasWatermark = async (options: Parameters<typeof renderDanfse>[1]) => {
      const pdf = await PDFDocument.load(await renderDanfse(FULL, options));
      const states = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
      return (states?.keys().length ?? 0) > 0;
    };
    assert.equal(await hasWatermark({ events: [fixture("national-event-replaced.xml")] }), true);
    assert.equal(await hasWatermark({ events: [] }), false);
    assert.equal(await hasWatermark({}), false);
  });

  it("nota mínima e todas as marcas d'água", async () => {
    for (const status of [undefined, "cancelled", "replaced"] as const) {
      const pdf = await PDFDocument.load(await renderDanfse(MINIMAL, { status }));
      assert.equal(pdf.getPageCount(), 1);
    }
  });
});

describe("DANFSe — entidades e telefone", () => {
  it("referências numéricas e hexadecimais são decodificadas", () => {
    const xml = fixture("national-nfse.xml").replace("Desenvolvimento de software", "Caf&#233; &#xE9; &amp; cia");
    assert.equal(buildDanfseData(xml).service.description, "Café é & cia");
  });

  it("telefone: fixo, celular e formatos que não são brasileiros", async () => {
    const { phone } = await import("../src/providers/nacional/danfse/danfse-data.ts");
    assert.equal(phone("1144445555"), "(11) 4444-5555");
    assert.equal(phone("11987654321"), "(11) 98765-4321");
    assert.equal(phone("+1 512 555 0100"), "+1 512 555 0100");
    assert.equal(phone(undefined), "-");
  });
});
