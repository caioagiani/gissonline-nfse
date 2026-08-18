import { digitsOnly } from "../infra/xml.ts";

/**
 * Address and company lookups through [BrasilAPI](https://brasilapi.com.br).
 *
 * Neither GissOnline service resolves a CNPJ, and the portal's own CEP endpoint
 * needs a session — so filling a party by hand means copying from the Receita's
 * site. These helpers close that gap.
 *
 * BrasilAPI is a free community service with no SLA and rate limits. Treat it as
 * a convenience: a failed lookup should never block issuing an invoice, and the
 * data is a starting point to be checked, not a source of truth.
 */

const BASE = "https://brasilapi.com.br/api";
const TIMEOUT_MS = 10_000;

/**
 * BrasilAPI answers 403 to requests without an identifying User-Agent — Node's
 * default is rejected. Identifying the client is also the polite thing to do
 * with a free service.
 */
const USER_AGENT = "gissonline-nfse (+https://github.com/caioagiani/gissonline-nfse)";

export interface ZipLookup {
  zipCode: string;
  street?: string;
  district?: string;
  city: string;
  state: string;
}

export interface CompanyLookup {
  taxId: string;
  legalName: string;
  tradeName?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  zipCode?: string;
  city: string;
  state: string;
  /** IBGE code, the same one the invoice needs */
  cityCode?: string;
  email?: string;
  phone?: string;
  /** "ATIVA", "BAIXADA", "SUSPENSA"… */
  status?: string;
  simplesNacionalOptant?: boolean;
}

export class LookupError extends Error {
  readonly status: number;

  constructor(what: string, status: number) {
    super(
      status === 404
        ? `${what} not found`
        : status === 429
          ? `Lookup for ${what} was rate limited — try again in a moment`
          : `Lookup for ${what} failed with HTTP ${status}`,
    );
    this.name = "LookupError";
    this.status = status;
  }
}

async function get<T>(route: string, what: string): Promise<T> {
  const response = await fetch(`${BASE}${route}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new LookupError(what, response.status);
  return (await response.json()) as T;
}

/** Resolves a Brazilian postal code into street, district, city and state. */
export async function lookupZip(zipCode: string): Promise<ZipLookup> {
  const digits = digitsOnly(zipCode);
  if (digits.length !== 8) {
    throw new Error(`Zip code must have 8 digits, got "${zipCode}"`);
  }

  const data = await get<{
    cep: string;
    street?: string;
    neighborhood?: string;
    city: string;
    state: string;
  }>(`/cep/v2/${digits}`, `zip code ${zipCode}`);

  return {
    zipCode: data.cep,
    street: data.street || undefined,
    district: data.neighborhood || undefined,
    city: data.city,
    state: data.state,
  };
}

/** Resolves a CNPJ into the company's registered details. */
export async function lookupCompany(taxId: string): Promise<CompanyLookup> {
  const digits = digitsOnly(taxId);
  if (digits.length !== 14) {
    throw new Error(`CNPJ must have 14 digits, got "${taxId}"`);
  }

  const data = await get<Record<string, unknown>>(
    `/cnpj/v1/${digits}`,
    `CNPJ ${taxId}`,
  );

  const text = (key: string): string | undefined => {
    const value = data[key];
    if (value === undefined || value === null) return undefined;
    const result = String(value).trim();
    return result === "" ? undefined : result;
  };

  return {
    taxId: digits,
    legalName: text("razao_social") ?? "",
    tradeName: text("nome_fantasia"),
    street: text("logradouro"),
    number: text("numero"),
    complement: text("complemento"),
    district: text("bairro"),
    zipCode: text("cep"),
    city: text("municipio") ?? "",
    state: text("uf") ?? "",
    cityCode: text("codigo_municipio_ibge"),
    email: text("email"),
    phone: text("ddd_telefone_1"),
    status: text("descricao_situacao_cadastral"),
    simplesNacionalOptant: data["opcao_pelo_simples"] === true,
  };
}

/**
 * Company details completed with the zip lookup — the CNPJ registry often
 * leaves the street blank while still carrying a usable postal code.
 */
export async function lookupParty(taxId: string): Promise<CompanyLookup> {
  const company = await lookupCompany(taxId);
  if (company.street || !company.zipCode) return company;

  try {
    const zip = await lookupZip(company.zipCode);
    return {
      ...company,
      street: company.street ?? zip.street,
      district: company.district ?? zip.district,
    };
  } catch {
    // the zip lookup is a bonus; the company data alone is still useful
    return company;
  }
}
