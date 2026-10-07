import { XMLParser } from "fast-xml-parser";
import { ValidationError } from "../../../domain/errors.ts";
import { ibgeMunicipality } from "./ibge-municipalities.ts";

/**
 * Conteúdo do DANFSe v2.0, campo a campo, como a NT 008 (v1.02) manda tirar do
 * XML da NFS-e. Tudo já vem formatado para impressão; o que o XML não traz sai
 * como "-" (nota 12). Nenhum dado é inventado: a nota proíbe imprimir o que não
 * consta do arquivo.
 */

export type DanfseStatus = "cancelled" | "replaced";

/** Eventos que tiram a validade da nota (tiposEventos v1.01). */
const CANCELLING = new Set([
  "101101", // cancelamento
  "105104", // cancelamento deferido por análise fiscal
  "305101", // cancelamento por ofício
]);
const REPLACING = "105102"; // cancelamento por substituição

/** A marca d'água que os eventos da nota pedem, se algum pedir. */
export function danfseStatus(events: Array<{ code?: string }>): DanfseStatus | undefined {
  if (events.some((e) => e.code === REPLACING)) return "replaced";
  if (events.some((e) => e.code !== undefined && CANCELLING.has(e.code))) return "cancelled";
  return undefined;
}

export interface DanfseParty {
  taxId: string;
  municipalRegistration: string;
  phone: string;
  name: string;
  city: string;
  cityCodeZip: string;
  address: string;
  email: string;
}

export interface DanfseData {
  header: {
    /** Vazio quando o código de tributação nacional é do item 99 */
    city: string;
    /** Código de um dígito (tabela 2.4.5): 1 Prefeitura, 2 Sistema Nacional */
    generator: string;
    /** Código de um dígito: 1 Produção, 2 Homologação */
    environment: string;
    /** tpAmb = 2: imprimir "NFS-e SEM VALIDADE JURÍDICA" */
    testing: boolean;
  };
  accessKey: string;
  qrCodeUrl: string;
  identification: {
    number: string;
    competence: string;
    processedAt: string;
    dpsNumber: string;
    dpsSeries: string;
    dpsIssuedAt: string;
    issuer: string;
    status: string;
    purpose: string;
  };
  provider: DanfseParty & { simplesNacional: string; simplesRegime: string };
  /** `undefined`: bloco suprimido ("NÃO IDENTIFICADO NA NFS-e") */
  taker?: DanfseParty;
  /** "taker": o destinatário é o próprio tomador */
  recipient?: Omit<DanfseParty, "municipalRegistration"> | "taker";
  intermediary?: DanfseParty;
  service: {
    taxCode: string;
    nbs: string;
    location: string;
    taxCodeDescription: string;
    description: string;
  };
  /** `undefined`: "OPERAÇÃO NÃO SUJEITA AO ISSQN" */
  municipalTax?: {
    taxation: string;
    incidence: string;
    specialRegime: string;
    immunity: string;
    suspension: string;
    suspensionProcess: string;
    benefit: string;
    benefitAmount: string;
    deductions: string;
    unconditionalDiscount: string;
    base: string;
    rate: string;
    withholding: string;
    amount: string;
    /** Linhas marcadas com ** no Anexo I: somem quando todos os campos estão vazios (nota 5) */
    showRegimeRow: boolean;
    showBenefitRow: boolean;
  };
  federalTax: {
    incomeTax: string;
    socialSecurity: string;
    socialContributions: string;
    /** Linha impressa só para competência até o fim de 2026 (nota 6) */
    showPisCofins: boolean;
    pis: string;
    cofins: string;
    socialContributionsDescription: string;
  };
  ibsCbs: {
    cstClassification: string;
    operation: string;
    exclusions: string;
    base: string;
    rateReductions: string;
    ibsRates: string;
    municipalEffectiveRate: string;
    municipalAmount: string;
    stateEffectiveRate: string;
    stateAmount: string;
    ibsTotal: string;
    cbsRate: string;
    cbsEffectiveRate: string;
    cbsAmount: string;
  };
  totals: {
    service: string;
    unconditionalDiscount: string;
    conditionalDiscount: string;
    withholdings: string;
    net: string;
    ibsCbs: string;
    netWithIbsCbs: string;
  };
  additionalInformation: string;
  /** Para o canhoto: "número / chave" */
  stub: string;
  status?: DanfseStatus;
}

const DASH = "-";

/** Descrições dos códigos, como o XSD v1.01 as define. */
const CODES = {
  tpEmit: { "1": "Prestador", "2": "Tomador", "3": "Intermediário" },
  cStat: {
    "100": "NFS-e Gerada",
    "101": "NFS-e de Substituição Gerada",
    "102": "NFS-e de Decisão Judicial",
    "103": "NFS-e Avulsa",
    "107": "NFS-e MEI",
  },
  finNFSe: { "0": "NFS-e regular" },
  opSimpNac: {
    "1": "Não Optante",
    "2": "Optante - Microempreendedor Individual (MEI)",
    "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
  },
  regApTribSN: {
    "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
    "2": "Regime de apuração dos tributos federais pelo Simples Nacional e ISSQN por fora do Simples Nacional conforme respectiva legislação municipal do tributo",
    "3": "Regime de apuração dos tributos federais e municipal por fora do Simples Nacional conforme respectivas legislações federal e municipal de cada tributo",
  },
  tribISSQN: {
    "1": "Operação Tributável",
    "2": "Imunidade",
    "3": "Exportação de serviço",
    "4": "Não Incidência",
  },
  regEspTrib: {
    "0": "Nenhum",
    "1": "Ato Cooperado (Cooperativa)",
    "2": "Estimativa",
    "3": "Microempresa Municipal",
    "4": "Notário ou Registrador",
    "5": "Profissional Autônomo",
    "6": "Sociedade de Profissionais",
    "9": "Outros",
  },
  tpImunidade: {
    "0": "Imunidade (tipo não informado na nota de origem)",
    "1": "Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)",
    "2": "Templos de qualquer culto (CF88, Art 150, VI, b)",
    "3": "Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos, atendidos os requisitos da lei (CF88, Art 150, VI, c)",
    "4": "Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)",
    "5": "Fonogramas e videofonogramas musicais produzidos no Brasil contendo obras musicais ou literomusicais de autores brasileiros e/ou obras em geral interpretadas por artistas brasileiros bem como os suportes materiais ou arquivos digitais que os contenham, salvo na etapa de replicação industrial de mídias ópticas de leitura a laser (CF88, Art 150, VI, e)",
  },
  tpSusp: {
    "1": "Exigibilidade Suspensa por Decisão Judicial",
    "2": "Exigibilidade Suspensa por Processo Administrativo",
  },
  tpBM: {
    "1": "Isenção",
    "2": "Redução da BC em percentual",
    "3": "Redução da BC em valor",
    "4": "Alíquota Diferenciada",
  },
  tpRetISSQN: {
    "1": "Não Retido",
    "2": "Retido pelo Tomador",
    "3": "Retido pelo Intermediário",
  },
  tpRetPisCofins: {
    "0": "PIS/COFINS/CSLL Não Retidos",
    "1": "PIS/COFINS Retidos",
    "2": "PIS/COFINS Não Retidos",
    "3": "PIS/COFINS/CSLL Retidos",
    "4": "PIS/COFINS Retidos, CSLL Não Retido",
    "5": "PIS Retido, COFINS/CSLL Não Retido",
    "6": "COFINS Retido, PIS/CSLL Não Retido",
    "7": "PIS Não Retido, COFINS/CSLL Retidos",
    "8": "PIS/COFINS Não Retidos, CSLL Retido",
    "9": "COFINS Não Retido, PIS/CSLL Retidos",
  },
} satisfies Record<string, Record<string, string>>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  // Sem isso, `&#233;` e `&#10;` chegam literais ao texto.
  htmlEntities: true,
  isArray: (name) => name === "gItemPed" || name === "docRef",
});

type Node = Record<string, unknown>;

const node = (value: unknown): Node =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};

/** Valor de texto num caminho `a/b/c`; vazio vira `undefined`. */
function at(root: unknown, path: string): string | undefined {
  let current: unknown = root;
  for (const part of path.split("/")) {
    if (current === undefined || current === null) return undefined;
    current = Array.isArray(current) ? current[0] : (current as Node)[part];
  }
  if (current === undefined || current === null || typeof current === "object") return undefined;
  const text = String(current).replace(/\r\n?/g, "\n").trim();
  return text === "" ? undefined : text;
}

function describe(table: Record<string, string>, code: string | undefined, max?: number): string {
  if (code === undefined) return DASH;
  const text = table[code] ?? code;
  return max ? clip(text, max) : text;
}

/** Corta com reticências quando o texto passa do tamanho sugerido, sem aparar o espaço, como o oficial. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

const number = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(value: number | string | undefined): string {
  const amount = typeof value === "string" ? number(value) : value;
  return amount === undefined ? DASH : `R$ ${brl.format(amount)}`;
}

function percent(value: string | undefined): string {
  const amount = number(value);
  return amount === undefined ? DASH : `${brl.format(amount)} %`;
}

/** Soma só o que existe; nada informado continua sendo "-". */
function sum(...values: Array<string | undefined>): number | undefined {
  const present = values.map(number).filter((v): v is number => v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : undefined;
}

/** DD/MM/AAAA, sem conversão de fuso: a data é a que está na nota. */
function date(value: string | undefined): string {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : DASH;
}

function dateTime(value: string | undefined): string {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}` : DASH;
}

export function formatTaxId(party: Node): string {
  const cnpj = at(party, "CNPJ");
  if (cnpj?.length === 14) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  const cpf = at(party, "CPF");
  if (cpf?.length === 11) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return at(party, "NIF") ?? cnpj ?? cpf ?? DASH;
}

/** Telefone brasileiro com DDD, como o Emissor Nacional imprime; outro formato fica como veio. */
export function phone(value: string | undefined): string {
  if (!value) return DASH;
  // Com código de país não é número nacional: fica exatamente como veio.
  if (value.trim().startsWith("+")) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  return value;
}

type MunicipalTax = NonNullable<DanfseData["municipalTax"]>;

function withOptionalRows(tax: Omit<MunicipalTax, "showRegimeRow" | "showBenefitRow">): MunicipalTax {
  const filled = (...values: string[]) => values.some((v) => v !== DASH);
  return {
    ...tax,
    // Regime "Nenhum" (0) não conta: o oficial suprime a linha.
    showRegimeRow: filled(
      tax.specialRegime === CODES.regEspTrib["0"] ? DASH : tax.specialRegime,
      tax.immunity,
      tax.suspension,
      tax.suspensionProcess,
    ),
    showBenefitRow: filled(tax.benefit, tax.benefitAmount, tax.deductions, tax.unconditionalDiscount),
  };
}

/** CEP no formato que a NT pede: nn.nnn-nnn. */
function zip(value: string | undefined): string | undefined {
  return value?.length === 8 ? value.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3") : value;
}

/** Código IBGE com o ponto depois da UF, como o oficial imprime: 35.52502. */
function ibgeCode(code: string): string {
  return code.replace(/^(\d{2})(\d{5})$/, "$1.$2");
}

function cityLabel(code: string | undefined): string | undefined {
  const city = ibgeMunicipality(code);
  return city ? `${city.name} / ${city.state}` : undefined;
}

function partyOf(party: Node, max = { name: 77, address: 77 }): DanfseParty {
  const address = node(party["end"]);
  const national = node(address["endNac"]);
  const foreign = node(address["endExt"]);
  const cityCode = at(national, "cMun");
  const street = [at(address, "xLgr"), at(address, "nro"), at(address, "xCpl"), at(address, "xBairro")]
    .filter(Boolean)
    .join(", ");
  const foreignCity = at(foreign, "xCidade");
  return {
    taxId: formatTaxId(party),
    municipalRegistration: at(party, "IM") ?? DASH,
    phone: phone(at(party, "fone")),
    name: clip(at(party, "xNome") ?? DASH, max.name),
    city: clip(
      cityLabel(cityCode) ?? (foreignCity ? `${foreignCity} / ${at(foreign, "cPais") ?? ""}`.trim() : cityCode ?? DASH),
      37,
    ),
    cityCodeZip: cityCode
      ? `${ibgeCode(cityCode)} / ${zip(at(national, "CEP")) ?? DASH}`
      : at(foreign, "cEndPost")
        ? `${at(foreign, "cEndPost")} (ext)`
        : DASH,
    address: street ? clip(street, max.address) : DASH,
    email: at(party, "email") ?? DASH,
  };
}

/** A NFS-e nacional, com o grupo `IBSCBS` quando a nota é v1.01. */
export function buildDanfseData(xml: string, status?: DanfseStatus): DanfseData {
  const root = node(node(parser.parse(xml))["NFSe"]);
  const inf = node(root["infNFSe"]);
  const id = at(inf, "@Id");
  if (!id) {
    throw new ValidationError("O XML não é de uma NFS-e nacional: falta NFSe/infNFSe@Id", {
      provider: "nacional",
    });
  }
  const accessKey = id.replace(/^NFS/, "");

  const dps = node(node(node(inf["DPS"]))["infDPS"]);
  const emit = node(inf["emit"]);
  const prest = node(dps["prest"]);
  const regTrib = node(prest["regTrib"]);
  const serv = node(dps["serv"]);
  const dpsValues = node(dps["valores"]);
  const trib = node(dpsValues["trib"]);
  const tribMun = node(trib["tribMun"]);
  const tribFed = node(trib["tribFed"]);
  const pisCofins = node(tribFed["piscofins"]);
  const nfseValues = node(inf["valores"]);
  const dpsIbs = node(dps["IBSCBS"]);
  const ibs = node(inf["IBSCBS"]);
  const ibsValues = node(ibs["valores"]);
  const ibsTotals = node(ibs["totCIBS"]);

  // Emitida pelo próprio prestador, a DPS não repete nome nem endereço: eles
  // vêm do cadastro e a SEFIN os grava em `emit`. É o mesmo contribuinte.
  // Telefone e e-mail, não: o oficial só imprime os que estão na DPS.
  const { fone: _fone, email: _email, ...registered } = emit;
  const providerSource =
    at(dps, "tpEmit") === "1" ? { ...registered, ...prest, end: prest["end"] ?? emit["enderNac"] } : prest;
  const providerAddress = node(providerSource["end"]);
  const provider = partyOf({
    ...providerSource,
    // `enderNac` do emitente já tem cMun/CEP no mesmo nível do logradouro
    end: providerAddress["endNac"] || providerAddress["endExt"]
      ? providerAddress
      : { ...providerAddress, endNac: { cMun: providerAddress["cMun"], CEP: providerAddress["CEP"] } },
  });

  const takerNode = node(dps["toma"]);
  const taker = Object.keys(takerNode).length ? partyOf(takerNode) : undefined;

  const recipientNode = node(dpsIbs["dest"]);
  const recipient = Object.keys(recipientNode).length
    ? (({ municipalRegistration: _, ...rest }) => rest)(partyOf(recipientNode))
    : at(dpsIbs, "indDest") === "0" && taker
      ? ("taker" as const)
      : undefined;

  const intermediaryNode = node(dps["interm"]);
  const intermediary = Object.keys(intermediaryNode).length ? partyOf(intermediaryNode) : undefined;

  const cServ = node(serv["cServ"]);
  const cTribNac = at(cServ, "cTribNac");
  const emitterState = at(emit, "enderNac/UF");

  const location = (city: string | undefined, cityCode: string | undefined, country: string | undefined) =>
    city ? clip(`${city} / ${ibgeMunicipality(cityCode)?.state ?? DASH} / ${country ?? DASH}`, 42) : DASH;

  const competence = at(dps, "dCompet");
  const retainedPisCofins = at(pisCofins, "tpRetPisCofins") === "1";
  const issuedTaxation = at(tribMun, "tribISSQN");
  const noIss = issuedTaxation === undefined || issuedTaxation === "4";
  const deductions = node(dpsValues["vDedRed"]);

  const totTrib = node(trib["totTrib"]);
  const approximate = (federal: string, state: string, municipal: string) => {
    const value = (amountPath: string, percentPath: string) => {
      const amount = at(totTrib, amountPath);
      if (amount !== undefined) return money(amount);
      const share = at(totTrib, percentPath);
      return share !== undefined ? percent(share) : DASH;
    };
    return (
      "Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: " +
      `Federais: ${value(`vTotTrib/${federal}`, `pTotTrib/p${federal.slice(1)}`)}; ` +
      `Estaduais: ${value(`vTotTrib/${state}`, `pTotTrib/p${state.slice(1)}`)}; ` +
      `Municipais: ${value(`vTotTrib/${municipal}`, `pTotTrib/p${municipal.slice(1)}`)};`
    );
  };

  const infoCompl = node(serv["infoCompl"]);
  const items = (infoCompl["gItemPed"] as unknown[] | undefined) ?? [];
  const extras: Array<[string, string | undefined]> = [
    ["Inf. Cont.: ", at(infoCompl, "xInfComp")],
    ["NFS-e Subst.: ", at(dps, "subst/chSubstda")],
    ["Doc. Ref.: ", at(infoCompl, "docRef")],
    ["Cod. Obra: ", at(serv, "obra/cObra")],
    ["Insc. Imob.: ", at(serv, "obra/inscImobFisc") ?? at(dpsIbs, "imovel/inscImobFisc")],
    ["Cod. Evt.: ", at(serv, "atvEvento/idAtvEvt")],
    ["Doc. Tec.: ", at(infoCompl, "idDocTec")],
    ["Núm. Ped.: ", at(infoCompl, "xPed")],
    ["Item Ped.: ", items.map((item) => at(item, "xItemPed")).filter(Boolean).join(", ") || undefined],
    ["Inf. A. T. Mun.: ", at(inf, "xOutInf")],
  ];
  const information = extras
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label}${value}`)
    .join(" | ");
  const totalsLine = approximate("vTotTribFed", "vTotTribEst", "vTotTribMun");
  // As reticências cortam as demais informações, nunca a linha dos tributos.
  const additionalInformation = [clip(information, Math.max(0, 1997 - totalsLine.length - 3)), totalsLine]
    .filter(Boolean)
    .join(" | ");

  const ibsTotal = at(ibsTotals, "gIBS/vIBSTot");
  const cbsTotal = at(ibsTotals, "gCBS/vCBS");

  return {
    header: {
      city: cTribNac?.startsWith("99")
        ? ""
        : clip(`${at(inf, "xLocEmi") ?? DASH}${emitterState ? ` - ${emitterState}` : ""}`, 37),
      generator: at(inf, "ambGer") ?? DASH,
      environment: at(dps, "tpAmb") ?? DASH,
      testing: at(dps, "tpAmb") === "2",
    },
    accessKey,
    qrCodeUrl: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${accessKey}`,
    identification: {
      number: at(inf, "nNFSe") ?? DASH,
      competence: date(competence),
      processedAt: dateTime(at(inf, "dhProc")),
      dpsNumber: at(dps, "nDPS") ?? DASH,
      dpsSeries: at(dps, "serie") ?? DASH,
      dpsIssuedAt: dateTime(at(dps, "dhEmi")),
      issuer: describe(CODES.tpEmit, at(dps, "tpEmit")),
      status: describe(CODES.cStat, at(inf, "cStat"), 40),
      purpose: describe(CODES.finNFSe, at(dpsIbs, "finNFSe"), 40),
    },
    provider: {
      ...provider,
      simplesNacional: describe(CODES.opSimpNac, at(regTrib, "opSimpNac"), 40),
      simplesRegime: describe(CODES.regApTribSN, at(regTrib, "regApTribSN"), 80),
    },
    taker,
    recipient,
    intermediary,
    service: {
      taxCode: `${cTribNac?.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3") ?? DASH} / ${at(cServ, "cTribMun") ?? DASH}`,
      nbs: at(cServ, "cNBS")?.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3.$4") ?? DASH,
      location: location(at(inf, "xLocPrestacao"), at(serv, "locPrest/cLocPrestacao"), at(serv, "locPrest/cPaisPrestacao")),
      taxCodeDescription: clip(at(inf, "xTribMun") ?? at(inf, "xTribNac") ?? DASH, 170),
      description: clip(at(cServ, "xDescServ") ?? DASH, 1300),
    },
    municipalTax: noIss
      ? undefined
      : withOptionalRows({
          taxation: describe(CODES.tribISSQN, issuedTaxation, 21),
          incidence: location(at(inf, "xLocIncid"), at(inf, "cLocIncid"), at(tribMun, "cPaisResult")),
          specialRegime: describe(CODES.regEspTrib, at(regTrib, "regEspTrib"), 27),
          immunity: describe(CODES.tpImunidade, at(tribMun, "tpImunidade"), 40),
          suspension: describe(CODES.tpSusp, at(tribMun, "exigSusp/tpSusp"), 40),
          suspensionProcess: at(tribMun, "exigSusp/nProcesso") ?? DASH,
          benefit: describe(CODES.tpBM, at(tribMun, "BM/tpBM") ?? at(nfseValues, "tpBM"), 40),
          benefitAmount: money(at(nfseValues, "vCalcBM") ?? at(tribMun, "BM/vRedBCBM")),
          deductions: money(
            at(nfseValues, "vDR") ??
              sum(at(deductions, "vDR"), at(ibsValues, "vCalcReeRepRes")),
          ),
          unconditionalDiscount: money(at(dpsValues, "vDescCondIncond/vDescIncond")),
          base: money(at(nfseValues, "vBC")),
          rate: percent(at(nfseValues, "pAliqAplic")),
          withholding: describe(CODES.tpRetISSQN, at(tribMun, "tpRetISSQN"), 25),
          amount: money(at(nfseValues, "vISSQN")),
        }),
    federalTax: {
      incomeTax: money(at(tribFed, "vRetIRRF")),
      socialSecurity: money(at(tribFed, "vRetCP")),
      socialContributions: money(
        retainedPisCofins
          ? sum(at(tribFed, "vRetCSLL"), at(pisCofins, "vPis"), at(pisCofins, "vCofins"))
          : at(tribFed, "vRetCSLL"),
      ),
      showPisCofins: competence === undefined || Number(competence.slice(0, 4)) <= 2026,
      pis: money(retainedPisCofins ? 0 : at(pisCofins, "vPis")),
      cofins: money(retainedPisCofins ? 0 : at(pisCofins, "vCofins")),
      socialContributionsDescription: (() => {
        const code = at(pisCofins, "tpRetPisCofins");
        return code === undefined ? DASH : clip(`${code} - ${describe(CODES.tpRetPisCofins, code)}`, 40);
      })(),
    },
    ibsCbs: {
      cstClassification: (() => {
        const group = node(node(node(dpsIbs["valores"])["trib"])["gIBSCBS"]);
        const cst = at(group, "CST");
        const classification = at(group, "cClassTrib");
        return `${cst ?? DASH} / ${classification ?? DASH}`;
      })(),
      operation: (() => {
        const code = at(ibs, "cLocalidadeIncid");
        const parts = [at(dpsIbs, "cIndOp"), code, at(ibs, "xLocalidadeIncid"), ibgeMunicipality(code)?.state];
        return clip(parts.map((p) => p ?? DASH).join(" / "), 56);
      })(),
      // Sem nada a excluir o oficial imprime R$ 0,00, não "-".
      exclusions: money(
        sum(
          at(dpsValues, "vDescCondIncond/vDescIncond"),
          at(ibsValues, "vCalcReeRepRes"),
          at(nfseValues, "vISSQN"),
          at(pisCofins, "vPis"),
          at(pisCofins, "vCofins"),
        ) ?? 0,
      ),
      base: money(at(ibsValues, "vBC")),
      rateReductions: [at(ibsValues, "uf/pRedAliqUF"), at(ibsValues, "mun/pRedAliqMun"), at(ibsValues, "fed/pRedAliqCBS")]
        .map(percent)
        .join(" / "),
      ibsRates: `${percent(at(ibsValues, "uf/pIBSUF"))} / ${percent(at(ibsValues, "mun/pIBSMun"))}`,
      municipalEffectiveRate: percent(at(ibsValues, "mun/pAliqEfetMun")),
      municipalAmount: money(at(ibsTotals, "gIBS/gIBSMunTot/vIBSMun")),
      stateEffectiveRate: percent(at(ibsValues, "uf/pAliqEfetUF")),
      stateAmount: money(at(ibsTotals, "gIBS/gIBSUFTot/vIBSUF")),
      ibsTotal: money(ibsTotal),
      cbsRate: percent(at(ibsValues, "fed/pCBS")),
      cbsEffectiveRate: percent(at(ibsValues, "fed/pAliqEfetCBS")),
      cbsAmount: money(cbsTotal),
    },
    totals: {
      service: money(at(dpsValues, "vServPrest/vServ")),
      unconditionalDiscount: money(at(dpsValues, "vDescCondIncond/vDescIncond")),
      conditionalDiscount: money(at(dpsValues, "vDescCondIncond/vDescCond")),
      withholdings: money(at(nfseValues, "vTotalRet")),
      net: money(at(nfseValues, "vLiq")),
      // Sem o grupo IBSCBS o oficial imprime R$ 0,00 nos dois, inclusive no
      // líquido + IBS/CBS (vTotNF ausente). Copiado como está.
      ibsCbs: money(sum(ibsTotal, cbsTotal) ?? 0),
      netWithIbsCbs: money(at(ibsTotals, "vTotNF") ?? 0),
    },
    additionalInformation,
    stub: `${at(inf, "nNFSe") ?? DASH} / ${accessKey}`,
    status,
  };
}
