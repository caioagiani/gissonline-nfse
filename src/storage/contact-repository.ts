import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address, ServiceTaker, Supplier } from "../domain/types.ts";
import { digitsOnly } from "../infra/xml.ts";

/**
 * Cadastro local de participantes.
 *
 * O Web Service SOAP não expõe cadastro — os participantes vivem dentro de cada
 * nota. Este repositório guarda os já usados para não redigitá-los a cada
 * emissão, alimentado pelas notas consultadas ou pelo cadastro do portal.
 */

export type ContactRole = "cliente" | "fornecedor";

export interface Contact {
  /** CPF ou CNPJ, somente dígitos — chave do registro */
  taxId: string;
  legalName: string;
  tradeName?: string;
  municipalRegistration?: string;
  email?: string;
  phone?: string;
  address?: Address;
  simplesNacionalOptant?: 1 | 2;
  alias?: string;
  notes?: string;
  updatedAt: string;
  /** "manual", "portal" ou o número da NFS-e que originou o registro */
  source: string;
}

interface ContactFile {
  clientes: Contact[];
  fornecedores: Contact[];
}

const EMPTY: ContactFile = { clientes: [], fornecedores: [] };

export class ContactRepository {
  readonly path: string;
  #data: ContactFile;

  constructor(path = "dados/catalogo.json") {
    this.path = resolve(path);
    const raw = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as Partial<ContactFile>)
      : structuredClone(EMPTY);
    this.#data = {
      clientes: (raw.clientes ?? []).map(migrate),
      fornecedores: (raw.fornecedores ?? []).map(migrate),
    };
  }

  #bucket(role: ContactRole): Contact[] {
    return role === "cliente" ? this.#data.clientes : this.#data.fornecedores;
  }

  list(role: ContactRole): Contact[] {
    return [...this.#bucket(role)].sort((a, b) =>
      a.legalName.localeCompare(b.legalName, "pt-BR"),
    );
  }

  /** Busca por documento, apelido ou trecho da razão social. */
  find(role: ContactRole, term: string): Contact | undefined {
    const digits = digitsOnly(term);
    const needle = term.toLowerCase();
    return this.#bucket(role).find(
      (contact) =>
        (digits.length > 0 && contact.taxId === digits) ||
        contact.alias?.toLowerCase() === needle ||
        contact.legalName.toLowerCase().includes(needle),
    );
  }

  /** Insere ou atualiza pelo documento. Campos ausentes preservam o valor anterior. */
  save(
    role: ContactRole,
    contact: Omit<Contact, "updatedAt" | "source"> & Partial<Pick<Contact, "source">>,
  ): Contact {
    const taxId = digitsOnly(contact.taxId);
    if (!taxId) throw new Error("Participante sem CPF/CNPJ");

    const bucket = this.#bucket(role);
    const existing = bucket.find((c) => c.taxId === taxId);
    const legalName = contact.legalName || existing?.legalName;
    if (!legalName) throw new Error(`Participante ${taxId} sem razão social`);

    const updated: Contact = {
      ...existing,
      ...omitEmpty(contact),
      taxId,
      legalName,
      updatedAt: new Date().toISOString(),
      source: contact.source ?? existing?.source ?? "manual",
    };

    if (existing) bucket[bucket.indexOf(existing)] = updated;
    else bucket.push(updated);

    this.#persist();
    return updated;
  }

  remove(role: ContactRole, taxId: string): boolean {
    const bucket = this.#bucket(role);
    const digits = digitsOnly(taxId);
    const index = bucket.findIndex((c) => c.taxId === digits);
    if (index < 0) return false;
    bucket.splice(index, 1);
    this.#persist();
    return true;
  }

  /** Converte um registro em tomador para emissão de NFS-e. */
  static asServiceTaker(contact: Contact): ServiceTaker {
    return {
      ...taxIdOf(contact.taxId),
      municipalRegistration: contact.municipalRegistration,
      legalName: contact.legalName,
      address: contact.address,
      contact:
        contact.email || contact.phone
          ? { email: contact.email, phone: contact.phone }
          : undefined,
    };
  }

  /** Converte um registro em fornecedor para declaração de serviço tomado. */
  static asSupplier(contact: Contact): Supplier {
    return {
      ...taxIdOf(contact.taxId),
      municipalRegistration: contact.municipalRegistration,
      legalName: contact.legalName,
      tradeName: contact.tradeName,
      address: contact.address,
      contact:
        contact.email || contact.phone
          ? { email: contact.email, phone: contact.phone }
          : undefined,
      simplesNacionalOptant: contact.simplesNacionalOptant,
    };
  }

  #persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.#data, null, 2)}\n`);
  }
}

/**
 * Converte registros gravados antes da migração para inglês. O arquivo é
 * regravado no formato novo na primeira alteração; até lá a leitura funciona
 * nos dois formatos.
 */
function migrate(record: Contact | LegacyContact): Contact {
  if ("taxId" in record) return record;

  const address = record.endereco;
  return {
    taxId: record.documento,
    legalName: record.razaoSocial,
    tradeName: record.nomeFantasia,
    municipalRegistration: record.inscricaoMunicipal,
    email: record.email,
    phone: record.telefone,
    address: address && {
      street: address.logradouro,
      number: address.numero,
      complement: address.complemento,
      district: address.bairro,
      cityCode: address.codigoMunicipio,
      state: address.uf,
      zipCode: address.cep,
    },
    simplesNacionalOptant: record.optanteSimplesNacional,
    alias: record.apelido,
    notes: record.observacao,
    updatedAt: record.atualizadoEm ?? new Date().toISOString(),
    source: record.origem ?? "manual",
  };
}

/** Formato anterior do arquivo, mantido só para a migração. */
interface LegacyContact {
  documento: string;
  razaoSocial: string;
  nomeFantasia?: string;
  inscricaoMunicipal?: string;
  email?: string;
  telefone?: string;
  endereco?: {
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    codigoMunicipio: string | number;
    uf: string;
    cep: string;
  };
  optanteSimplesNacional?: 1 | 2;
  apelido?: string;
  observacao?: string;
  atualizadoEm?: string;
  origem?: string;
}

/** Decide entre CPF e CNPJ pelo tamanho do documento. */
export function taxIdOf(taxId: string): { cpf?: string; cnpj?: string } {
  const digits = digitsOnly(taxId);
  return digits.length > 11 ? { cnpj: digits } : { cpf: digits };
}

function omitEmpty<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ""),
  ) as Partial<T>;
}
