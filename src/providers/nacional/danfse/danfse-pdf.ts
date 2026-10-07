import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import qrcode from "qrcode-generator";
import { buildDanfseData, type DanfseData, type DanfseParty, type DanfseStatus } from "./danfse-data.ts";
import { NFSE_LOGO_PNG } from "./logo.ts";

/**
 * DANFSe v2.0 — o documento auxiliar da NFS-e, no modelo do Anexo I da NT 008
 * (v1.02). Desde 03/08/2026 a API nacional não gera mais o PDF: o sistema
 * emissor gera, a partir do XML, e o resultado tem o mesmo valor do que a API
 * gerava.
 *
 * Medidas em centímetros, como na tabela do item 2.4.5. As fontes Arial e
 * Microsoft Sans Serif são proprietárias e não podem ser embutidas; a
 * Helvetica, padrão do PDF, tem as mesmas métricas da Arial.
 */

export interface DanfseOptions {
  /** Marca d'água "CANCELADA" ou "SUBSTITUÍDA" (item 2.5). Vem dos eventos da nota. */
  status?: DanfseStatus;
}

const CM = 72 / 2.54;
const PAGE = { width: 21, height: 29.7 };
const LEFT = 0.3;
const WIDTH = 20.4;
/** Colunas do modelo: quatro de 5,09 cm, com 0,02 cm entre elas */
const COL = [0.3, 5.41, 10.51, 15.62] as const;
const COL_WIDTH = 5.09;
const WIDE = 10.19;

const BLACK = rgb(0, 0, 0);
/** Cinza claro, 5% de densidade (item 2.2.3) */
const SHADE = rgb(0.95, 0.95, 0.95);
/** Cinza K35 da marca d'água (item 2.5) */
const WATERMARK = rgb(0.65, 0.65, 0.65);
/** Vermelho sólido M100/Y100 do aviso de homologação */
const RED = rgb(1, 0, 0);

const LINE_HEIGHT = 0.3;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function renderDanfse(xml: string, options: DanfseOptions = {}): Promise<Uint8Array> {
  return drawDanfse(buildDanfseData(xml, options.status));
}

export async function drawDanfse(data: DanfseData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFSe ${data.identification.number}`);
  pdf.setSubject(`NFS-e ${data.accessKey}`);
  pdf.setProducer("nfse-br");
  pdf.setCreator("nfse-br");

  const page = pdf.addPage([PAGE.width * CM, PAGE.height * CM]);
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const canvas = new Canvas(page, fonts);
  const logo = await pdf.embedPng(NFSE_LOGO_PNG);

  // Borda da página: 1 ponto (item 2.2.3), dentro da margem de 0,20 cm.
  canvas.rect(0.2, 0.2, PAGE.width - 0.4, PAGE.height - 0.4, { border: 1 });

  let y = header(canvas, data, logo);
  y = identification(canvas, data, y);
  y = provider(canvas, data, y);

  // Blocos que podem encolher (item 2.3): o espaço economizado vai para a
  // descrição do serviço e para as informações complementares, calculadas
  // depois do tomador, destinatário e intermediário.
  const municipalHeight = data.municipalTax ? 2.59 : 0.32;
  const federalHeight = data.federalTax.showPisCofins ? 1.3 : 0.65;
  const fixedAfterService = municipalHeight + federalHeight + 2.58 + 1.37 + 0.41;
  const stubTop = 28.1;

  y = party(canvas, "TOMADOR / ADQUIRENTE", "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", data.taker, y);
  y = recipient(canvas, data, y);
  y = party(
    canvas,
    "INTERMEDIÁRIO DA OPERAÇÃO",
    "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e",
    data.intermediary,
    y,
  );

  // Espaço livre entre o serviço e o canhoto, dividido entre a descrição e as
  // informações complementares conforme o que cada uma precisa.
  const serviceHead = 0.65 + 0.4;
  const free = stubTop - y - serviceHead - fixedAfterService;
  const descriptionLines = canvas.wrap(data.service.description, fonts.regular, 7, WIDTH - 0.2);
  const informationLines = canvas.wrap(data.additionalInformation, fonts.regular, 7, WIDTH - 0.2);
  const need = (lines: number) => lines * LINE_HEIGHT + 0.2;
  // Pelo modelo, a descrição tem 0,64 cm e as informações ficam com o resto;
  // o que os blocos suprimidos economizam vai para a descrição (item 2.3).
  // Se mesmo assim o texto não couber, a descrição avança sobre o espaço que
  // as informações não usam.
  const suppressed =
    (data.taker ? 0 : 1.62) +
    (data.recipient && data.recipient !== "taker" ? 0 : 1.62) +
    (data.intermediary ? 0 : 1.62) +
    (data.municipalTax ? 0 : 2.27) +
    (data.federalTax.showPisCofins ? 0 : 0.65);
  const informationNeed = Math.max(0.39, need(informationLines.length));
  const descriptionHeight = Math.min(
    Math.max(0.64 + suppressed, need(descriptionLines.length) + 0.3),
    Math.max(0.64, free - informationNeed),
  );

  y = service(canvas, data, y, descriptionHeight, descriptionLines);
  y = municipalTax(canvas, data, y);
  y = federalTax(canvas, data, y);
  y = ibsCbs(canvas, data, y);
  y = totals(canvas, data, y);
  information(canvas, informationLines, y, stubTop - y);
  stub(canvas, data, stubTop);

  if (data.status) {
    canvas.watermark(data.status === "cancelled" ? "CANCELADA" : "SUBSTITUÍDA");
  }

  return pdf.save();
}

function header(canvas: Canvas, data: DanfseData, logo: Awaited<ReturnType<PDFDocument["embedPng"]>>): number {
  canvas.rect(LEFT, 0.3, WIDTH, 1.16, { fill: SHADE });
  const logoHeight = (4 * logo.height) / logo.width;
  canvas.image(logo, 0.49, 0.44 + (0.85 - logoHeight) / 2, 4, logoHeight);

  const center = 5.41 + 10.19 / 2;
  canvas.centered("DANFSe v2.0", center, 0.68, 9, canvas.fonts.bold);
  canvas.centered("Documento Auxiliar da NFS-e", center, 1.04, 9, canvas.fonts.bold);
  if (data.header.testing) {
    canvas.centered("NFS-e SEM VALIDADE JURÍDICA", center, 1.38, 9, canvas.fonts.bold, RED);
  }

  if (data.header.city) canvas.text(`Município: ${data.header.city}`, 15.62, 0.66, 8, canvas.fonts.regular);
  canvas.text(`Ambiente Gerador: ${data.header.generator}`, 15.62, 1.13, 6, canvas.fonts.regular);
  canvas.text(`Tipo de Ambiente: ${data.header.environment}`, 15.62, 1.38, 6, canvas.fonts.regular);
  return 1.48;
}

function identification(canvas: Canvas, data: DanfseData, y: number): number {
  const id = data.identification;
  canvas.line(y);
  canvas.field(COL[0], y, 15.3, "CHAVE DE ACESSO DA NFS-E", data.accessKey, { caps: true, height: 0.77 });
  canvas.field(COL[0], 2.27, COL_WIDTH, "NÚMERO DA NFS-E", id.number, { caps: true });
  canvas.field(COL[1], 2.27, COL_WIDTH, "COMPETÊNCIA DA NFS-E", id.competence, { caps: true });
  canvas.field(COL[2], 2.27, COL_WIDTH, "DATA E HORA DA EMISSÃO DA NFS-E", id.processedAt, { caps: true });
  canvas.field(COL[0], 2.96, COL_WIDTH, "NÚMERO DA DPS", id.dpsNumber, { caps: true });
  canvas.field(COL[1], 2.96, COL_WIDTH, "SÉRIE DA DPS", id.dpsSeries, { caps: true });
  canvas.field(COL[2], 2.96, COL_WIDTH, "DATA E HORA DA EMISSÃO DA DPS", id.dpsIssuedAt, { caps: true });
  canvas.field(COL[0], 3.65, COL_WIDTH, "EMITENTE DA NFS-E", id.issuer, { caps: true, shade: true });
  canvas.field(COL[1], 3.65, COL_WIDTH, "SITUAÇÃO DA NFS-E", id.status, { caps: true });
  canvas.field(COL[2], 3.65, COL_WIDTH, "FINALIDADE", id.purpose, { caps: true });

  canvas.qr(data.qrCodeUrl, 17.48, 1.67, 1.52);
  canvas.paragraph(
    "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e",
    15.8,
    3.36,
    4.72,
    6,
    3,
  );
  return 4.34;
}

function partyRows(canvas: Canvas, title: string, party: DanfseParty, y: number, withRegistration = true): number {
  canvas.line(y);
  canvas.title(title, y);
  canvas.field(COL[1], y, COL_WIDTH, "CNPJ / CPF / NIF", party.taxId);
  if (withRegistration) {
    canvas.field(COL[2], y, COL_WIDTH, "Indicador Municipal (Inscrição)", party.municipalRegistration);
  }
  canvas.field(COL[3], y, COL_WIDTH, "Telefone", party.phone);
  canvas.field(COL[0], y + 0.64, WIDE, "Nome / Nome Empresarial", party.name);
  canvas.field(COL[2], y + 0.64, COL_WIDTH, "Município / Sigla UF", party.city);
  canvas.field(COL[3], y + 0.64, COL_WIDTH, "Código IBGE / CEP", party.cityCodeZip);
  canvas.field(COL[0], y + 1.3, WIDE, "Endereço", party.address);
  canvas.field(COL[2], y + 1.3, WIDE, "E-mail", party.email);
  return y + 1.94;
}

function provider(canvas: Canvas, data: DanfseData, y: number): number {
  y = partyRows(canvas, "PRESTADOR / FORNECEDOR", data.provider, y);
  canvas.field(COL[0], y, COL_WIDTH, "Simples Nacional na Data de Competência", data.provider.simplesNacional);
  canvas.field(COL[1], y, WIDE, "Regime de Apuração Tributária pelo SN", data.provider.simplesRegime);
  return y + 0.64;
}

function party(canvas: Canvas, title: string, missing: string, data: DanfseParty | undefined, y: number): number {
  if (data) return partyRows(canvas, title, data, y);
  canvas.line(y);
  canvas.centered(missing, LEFT + WIDTH / 2, y + 0.23, 7, canvas.fonts.regular);
  return y + 0.32;
}

function recipient(canvas: Canvas, data: DanfseData, y: number): number {
  if (data.recipient === "taker") {
    canvas.line(y);
    canvas.centered("O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO", LEFT + WIDTH / 2, y + 0.23, 7, canvas.fonts.regular);
    return y + 0.32;
  }
  if (!data.recipient) {
    return party(canvas, "", "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", undefined, y);
  }
  return partyRows(
    canvas,
    "DESTINATÁRIO DA OPERAÇÃO",
    { ...data.recipient, municipalRegistration: "" },
    y,
    false,
  );
}

function service(canvas: Canvas, data: DanfseData, y: number, height: number, lines: string[]): number {
  canvas.line(y);
  canvas.title("SERVIÇO PRESTADO", y);
  canvas.field(COL[1], y, COL_WIDTH, "Código de Tributação Nacional / Municipal", data.service.taxCode);
  canvas.field(COL[2], y, COL_WIDTH, "Código da NBS", data.service.nbs);
  canvas.field(COL[3], y, COL_WIDTH, "Local da Prestação / Sigla UF / País", data.service.location);
  // Sem título (label), como manda a tabela.
  canvas.text(canvas.fit(data.service.taxCodeDescription, canvas.fonts.regular, 7, WIDTH - 0.2), LEFT + 0.1, y + 0.9, 7, canvas.fonts.regular);
  const top = y + 1.05;
  canvas.text("Descrição do Serviço", LEFT + 0.1, top + 0.22, 6, canvas.fonts.bold);
  const room = Math.max(1, Math.floor((height - 0.32) / LINE_HEIGHT));
  const shown = lines.length > room ? [...lines.slice(0, room - 1), `${lines[room - 1] ?? ""}...`] : lines;
  shown.forEach((line, index) => {
    canvas.text(line, LEFT + 0.1, top + 0.5 + index * LINE_HEIGHT, 7, canvas.fonts.regular);
  });
  return top + height;
}

function municipalTax(canvas: Canvas, data: DanfseData, y: number): number {
  const tax = data.municipalTax;
  if (!tax) {
    canvas.line(y);
    canvas.centered("TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN", LEFT + WIDTH / 2, y + 0.23, 7, canvas.fonts.regular);
    return y + 0.32;
  }
  canvas.line(y);
  canvas.title("TRIBUTAÇÃO MUNICIPAL (ISSQN)", y);
  canvas.field(COL[1], y, COL_WIDTH, "Tipo de Tributação do ISSQN", tax.taxation);
  canvas.field(COL[2], y, WIDE, "Município / Sigla UF / País de Incidência do ISSQN", tax.incidence);
  canvas.field(COL[0], y + 0.65, COL_WIDTH, "Regime Especial de Tributação do ISSQN", tax.specialRegime);
  canvas.field(COL[1], y + 0.65, COL_WIDTH, "Tipo de Imunidade do ISSQN", tax.immunity);
  canvas.field(COL[2], y + 0.65, COL_WIDTH, "Suspensão da Exigibilidade do ISSQN", tax.suspension);
  canvas.field(COL[3], y + 0.65, COL_WIDTH, "Número Processo Suspensão", tax.suspensionProcess);
  canvas.field(COL[0], y + 1.3, COL_WIDTH, "Benefício Municipal", tax.benefit);
  canvas.field(COL[1], y + 1.3, COL_WIDTH, "Cálculo do BM", tax.benefitAmount);
  canvas.field(COL[2], y + 1.3, COL_WIDTH, "Total Deduções/Reduções", tax.deductions);
  canvas.field(COL[3], y + 1.3, COL_WIDTH, "Desconto Incondicionado", tax.unconditionalDiscount);
  canvas.field(COL[0], y + 1.94, COL_WIDTH, "BC ISSQN", tax.base);
  canvas.field(COL[1], y + 1.94, COL_WIDTH, "Alíquota Aplicada", tax.rate);
  canvas.field(COL[2], y + 1.94, COL_WIDTH, "Retenção do ISSQN", tax.withholding);
  canvas.field(COL[3], y + 1.94, COL_WIDTH, "ISSQN Apurado", tax.amount);
  return y + 2.59;
}

function federalTax(canvas: Canvas, data: DanfseData, y: number): number {
  const tax = data.federalTax;
  canvas.line(y);
  canvas.title("TRIBUTAÇÃO FEDERAL (EXCETO CBS)", y);
  canvas.field(COL[1], y, COL_WIDTH, "IRRF", tax.incomeTax);
  canvas.field(COL[2], y, COL_WIDTH, "Contribuição Previdenciária - Retida", tax.socialSecurity);
  canvas.field(COL[3], y, COL_WIDTH, "Contribuições Sociais - Retidas", tax.socialContributions);
  if (!tax.showPisCofins) return y + 0.65;
  canvas.field(COL[0], y + 0.65, COL_WIDTH, "PIS - Débito Apuração Própria", tax.pis);
  canvas.field(COL[1], y + 0.65, COL_WIDTH, "COFINS - Débito Apuração Própria", tax.cofins);
  canvas.field(COL[2], y + 0.65, WIDE, "Descrição Contrib. Sociais - Retidas", tax.socialContributionsDescription);
  return y + 1.3;
}

function ibsCbs(canvas: Canvas, data: DanfseData, y: number): number {
  const tax = data.ibsCbs;
  canvas.line(y);
  canvas.title("TRIBUTAÇÃO IBS / CBS", y);
  canvas.field(COL[1], y, COL_WIDTH, "CST / cClassTrib", tax.cstClassification);
  canvas.field(COL[2], y, WIDE, "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF", tax.operation);
  canvas.field(COL[0], y + 0.64, COL_WIDTH, "Exclusões e Reduções da Base de Cálculo", tax.exclusions);
  canvas.field(COL[1], y + 0.64, COL_WIDTH, "Base de Cálculo Após Exclusões e Reduções", tax.base);
  canvas.field(COL[2], y + 0.64, COL_WIDTH, "Red. Alíquota IBS / Red. Alíquota CBS", tax.rateReductions);
  canvas.field(COL[3], y + 0.64, COL_WIDTH, "Alíquota - IBS UF / IBS Mun", tax.ibsRates);
  canvas.field(COL[0], y + 1.29, COL_WIDTH, "Alíq. Efetiva Municipal - IBS", tax.municipalEffectiveRate);
  canvas.field(COL[1], y + 1.29, COL_WIDTH, "Valor Apurado Municipal - IBS", tax.municipalAmount);
  canvas.field(COL[2], y + 1.29, COL_WIDTH, "Alíq. Efetiva Estadual - IBS", tax.stateEffectiveRate);
  canvas.field(COL[3], y + 1.29, COL_WIDTH, "Valor Apurado Estadual - IBS", tax.stateAmount);
  canvas.field(COL[0], y + 1.94, COL_WIDTH, "Valor Total Apurado - IBS", tax.ibsTotal);
  canvas.field(COL[1], y + 1.94, COL_WIDTH, "Alíquota - CBS", tax.cbsRate);
  canvas.field(COL[2], y + 1.94, COL_WIDTH, "Alíquota Efetiva - CBS", tax.cbsEffectiveRate);
  canvas.field(COL[3], y + 1.94, COL_WIDTH, "Valor Total Apurado - CBS", tax.cbsAmount);
  return y + 2.58;
}

function totals(canvas: Canvas, data: DanfseData, y: number): number {
  const total = data.totals;
  canvas.line(y);
  canvas.title("VALOR TOTAL DA NFS-E", y, 0.69);
  canvas.field(COL[1], y, COL_WIDTH, "VALOR DA OPERAÇÃO / SERVIÇO", total.service, { caps: true, height: 0.69 });
  canvas.field(COL[2], y, COL_WIDTH, "Desconto Incondicionado", total.unconditionalDiscount, { height: 0.69 });
  canvas.field(COL[3], y, COL_WIDTH, "Desconto Condicionado", total.conditionalDiscount, { height: 0.69 });
  canvas.field(COL[0], y + 0.69, COL_WIDTH, "Total das Retenções (ISSQN / Federais)", total.withholdings, { height: 0.68 });
  canvas.field(COL[1], y + 0.69, COL_WIDTH, "VALOR LÍQUIDO DA NFS-E", total.net, { caps: true, height: 0.68 });
  canvas.field(COL[2], y + 0.69, COL_WIDTH, "Total do IBS/CBS", total.ibsCbs, { height: 0.68 });
  canvas.field(COL[3], y + 0.69, COL_WIDTH, "VALOR LÍQUIDO DA NFS-E + IBS/CBS", total.netWithIbsCbs, {
    caps: true,
    height: 0.68,
    shade: true,
  });
  return y + 1.37;
}

function information(canvas: Canvas, lines: string[], y: number, height: number): void {
  canvas.line(y);
  canvas.title("INFORMAÇÕES COMPLEMENTARES", y, 0.41, WIDTH);
  const room = Math.max(1, Math.floor((height - 0.5) / LINE_HEIGHT));
  // O texto já vem com a linha dos tributos por último; se não couber, as
  // reticências entram antes dela, que é obrigatória (nota 10).
  const shown =
    lines.length > room
      ? [...lines.slice(0, room - 2), `${lines[room - 2] ?? ""}...`, ...lines.slice(-1)]
      : lines;
  shown.forEach((line, index) => {
    canvas.text(line, LEFT + 0.1, y + 0.66 + index * LINE_HEIGHT, 7, canvas.fonts.regular);
  });
}

function stub(canvas: Canvas, data: DanfseData, y: number): void {
  canvas.rect(LEFT, y, WIDTH, 0.67, { border: 0.5 });
  canvas.vline(COL[1] - 0.01, y, 0.67);
  canvas.vline(COL[2] - 0.01, y, 0.67);
  canvas.field(COL[0], y, COL_WIDTH, "DATA CIENTIFICAÇÃO:", "", { caps: true });
  canvas.field(COL[1], y, COL_WIDTH, "IDENTIFICAÇÃO E ASSINATURA", "", { caps: true });
  canvas.field(COL[2], y, WIDE, "Nº NFS-e / CHAVE NFS-e", data.stub, { caps: true });
}

/** Desenho em centímetros, com a origem no canto superior esquerdo. */
class Canvas {
  readonly page: PDFPage;
  readonly fonts: Fonts;
  readonly #safe = new Map<string, string>();

  constructor(page: PDFPage, fonts: Fonts) {
    this.page = page;
    this.fonts = fonts;
  }

  #y(top: number): number {
    return (PAGE.height - top) * CM;
  }

  /**
   * As fontes padrão do PDF só codificam WinAnsi. Acentos do português estão
   * lá; um caractere fora dela (emoji, ideograma) vira "?" em vez de quebrar.
   */
  safe(text: string, font: PDFFont): string {
    const key = text;
    const cached = this.#safe.get(key);
    if (cached !== undefined) return cached;
    const result = [...text.normalize("NFC").replace(/[\r\n\t]+/g, " ")]
      .map((char) => {
        try {
          font.encodeText(char);
          return char;
        } catch {
          return "?";
        }
      })
      .join("");
    this.#safe.set(key, result);
    return result;
  }

  width(text: string, font: PDFFont, size: number): number {
    return font.widthOfTextAtSize(this.safe(text, font), size) / CM;
  }

  /** Corta com reticências pela largura real do texto. */
  fit(text: string, font: PDFFont, size: number, width: number): string {
    if (this.width(text, font, size) <= width) return text;
    let end = text.length;
    while (end > 0 && this.width(`${text.slice(0, end)}...`, font, size) > width) end--;
    return `${text.slice(0, end).trimEnd()}...`;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.width(candidate, font, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = this.width(word, font, size) <= width ? word : this.fit(word, font, size, width);
    }
    if (line) lines.push(line);
    return lines;
  }

  text(text: string, x: number, baseline: number, size: number, font: PDFFont, color = BLACK): void {
    if (!text) return;
    this.page.drawText(this.safe(text, font), { x: x * CM, y: this.#y(baseline), size, font, color });
  }

  centered(text: string, center: number, baseline: number, size: number, font: PDFFont, color = BLACK): void {
    this.text(text, center - this.width(text, font, size) / 2, baseline, size, font, color);
  }

  paragraph(text: string, x: number, top: number, width: number, size: number, maxLines: number): void {
    this.wrap(text, this.fonts.regular, size, width)
      .slice(0, maxLines)
      .forEach((line, index) => this.text(line, x, top + 0.2 + index * 0.22, size, this.fonts.regular));
  }

  rect(x: number, top: number, width: number, height: number, style: { fill?: ReturnType<typeof rgb>; border?: number }): void {
    this.page.drawRectangle({
      x: x * CM,
      y: this.#y(top + height),
      width: width * CM,
      height: height * CM,
      color: style.fill,
      borderColor: style.border ? BLACK : undefined,
      borderWidth: style.border ?? 0,
    });
  }

  /** Linha divisória entre blocos: 0,5 ponto (item 2.2.3). */
  line(top: number): void {
    this.page.drawLine({
      start: { x: LEFT * CM, y: this.#y(top) },
      end: { x: (LEFT + WIDTH) * CM, y: this.#y(top) },
      thickness: 0.5,
      color: BLACK,
    });
  }

  vline(x: number, top: number, height: number): void {
    this.page.drawLine({
      start: { x: x * CM, y: this.#y(top) },
      end: { x: x * CM, y: this.#y(top + height) },
      thickness: 0.5,
      color: BLACK,
    });
  }

  /** Título do bloco: 7 pt, negrito, caixa alta, com fundo cinza. */
  title(text: string, top: number, height = 0.63, width = COL_WIDTH): void {
    if (!text) return;
    this.rect(LEFT, top, width, height, { fill: SHADE });
    this.text(text, LEFT + 0.05, top + 0.28, 7, this.fonts.bold);
  }

  /**
   * Campo: título em 6 pt negrito (7 pt e caixa alta na identificação da NFS-e)
   * e conteúdo em 7 pt. Campo sem informação no XML já vem como "-".
   */
  field(
    x: number,
    top: number,
    width: number,
    label: string,
    value: string,
    options: { caps?: boolean; shade?: boolean; height?: number } = {},
  ): void {
    if (options.shade) this.rect(x, top, width, options.height ?? 0.63, { fill: SHADE });
    const labelSize = options.caps ? 7 : 6;
    this.text(this.fit(label, this.fonts.bold, labelSize, width - 0.1), x + 0.05, top + 0.27, labelSize, this.fonts.bold);
    this.text(this.fit(value, this.fonts.regular, 7, width - 0.1), x + 0.05, top + 0.55, 7, this.fonts.regular);
  }

  image(image: Awaited<ReturnType<PDFDocument["embedPng"]>>, x: number, top: number, width: number, height: number): void {
    this.page.drawImage(image, { x: x * CM, y: this.#y(top + height), width: width * CM, height: height * CM });
  }

  /** QR Code em vetor, nítido em qualquer impressão (mínimo 1,52 cm). */
  qr(content: string, x: number, top: number, size: number): void {
    const code = qrcode(0, "M");
    code.addData(content);
    code.make();
    const count = code.getModuleCount();
    const module = size / count;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!code.isDark(row, col)) continue;
        this.page.drawRectangle({
          x: (x + col * module) * CM,
          y: this.#y(top + (row + 1) * module),
          width: module * CM + 0.05,
          height: module * CM + 0.05,
          color: BLACK,
        });
      }
    }
  }

  /** Marca d'água na diagonal: 50 pt no mínimo, Arial, cinza K35 (item 2.5). */
  watermark(text: string): void {
    const size = 90;
    const font = this.fonts.regular;
    const width = font.widthOfTextAtSize(this.safe(text, font), size);
    const angle = 55;
    const radians = (angle * Math.PI) / 180;
    const cx = (PAGE.width / 2) * CM;
    const cy = (PAGE.height / 2) * CM;
    this.page.drawText(this.safe(text, font), {
      x: cx - (Math.cos(radians) * width) / 2 + (Math.sin(radians) * size * 0.35),
      y: cy - (Math.sin(radians) * width) / 2 - (Math.cos(radians) * size * 0.35),
      size,
      font,
      color: WATERMARK,
      opacity: 0.6,
      rotate: degrees(angle),
    });
  }
}
