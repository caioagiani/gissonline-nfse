import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Endereco, Fornecedor, Tomador } from "./types.ts";
import { somenteDigitos } from "./xml.ts";

/**
 * O Web Service do GissOnline não expõe cadastro de clientes ou fornecedores —
 * o cadastro vive dentro de cada nota. Este catálogo local guarda os
 * participantes já usados para não redigitá-los a cada emissão, e é alimentado
 * automaticamente a partir das notas consultadas.
 */

export type Papel = "cliente" | "fornecedor";

export interface Participante {
  /** CPF ou CNPJ, somente dígitos — chave do registro */
  documento: string;
  razaoSocial: string;
  nomeFantasia?: string;
  inscricaoMunicipal?: string;
  email?: string;
  telefone?: string;
  endereco?: Endereco;
  /** 1 = sim, 2 = não */
  optanteSimplesNacional?: 1 | 2;
  apelido?: string;
  observacao?: string;
  atualizadoEm: string;
  /** "manual" ou o número da NFS-e que originou o registro */
  origem: string;
}

interface Arquivo {
  clientes: Participante[];
  fornecedores: Participante[];
}

const VAZIO: Arquivo = { clientes: [], fornecedores: [] };

export class Catalogo {
  readonly caminho: string;
  private dados: Arquivo;

  constructor(caminho = "dados/catalogo.json") {
    this.caminho = resolve(caminho);
    this.dados = existsSync(this.caminho)
      ? (JSON.parse(readFileSync(this.caminho, "utf8")) as Arquivo)
      : structuredClone(VAZIO);
    this.dados.clientes ??= [];
    this.dados.fornecedores ??= [];
  }

  private lista(papel: Papel): Participante[] {
    return papel === "cliente" ? this.dados.clientes : this.dados.fornecedores;
  }

  listar(papel: Papel): Participante[] {
    return [...this.lista(papel)].sort((a, b) =>
      a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"),
    );
  }

  /** Busca por documento, apelido ou trecho da razão social. */
  buscar(papel: Papel, termo: string): Participante | undefined {
    const digitos = somenteDigitos(termo);
    const alvo = termo.toLowerCase();
    return this.lista(papel).find(
      (p) =>
        (digitos.length > 0 && p.documento === digitos) ||
        p.apelido?.toLowerCase() === alvo ||
        p.razaoSocial.toLowerCase().includes(alvo),
    );
  }

  /** Insere ou atualiza pelo documento. Campos ausentes preservam o valor anterior. */
  registrar(
    papel: Papel,
    participante: Omit<Participante, "atualizadoEm" | "origem"> &
      Partial<Pick<Participante, "origem">>,
  ): Participante {
    const documento = somenteDigitos(participante.documento);
    if (!documento) throw new Error("Participante sem CPF/CNPJ");

    const lista = this.lista(papel);
    const existente = lista.find((p) => p.documento === documento);
    const razaoSocial = participante.razaoSocial || existente?.razaoSocial;
    if (!razaoSocial) throw new Error(`Participante ${documento} sem razão social`);

    const atualizado: Participante = {
      ...existente,
      ...limpar(participante),
      documento,
      razaoSocial,
      atualizadoEm: new Date().toISOString(),
      origem: participante.origem ?? existente?.origem ?? "manual",
    };

    if (existente) lista[lista.indexOf(existente)] = atualizado;
    else lista.push(atualizado);

    this.salvar();
    return atualizado;
  }

  remover(papel: Papel, documento: string): boolean {
    const lista = this.lista(papel);
    const digitos = somenteDigitos(documento);
    const indice = lista.findIndex((p) => p.documento === digitos);
    if (indice < 0) return false;
    lista.splice(indice, 1);
    this.salvar();
    return true;
  }

  /** Converte um registro do catálogo em tomador para emissão de NFS-e. */
  comoTomador(participante: Participante): Tomador {
    return {
      ...documentoDe(participante.documento),
      inscricaoMunicipal: participante.inscricaoMunicipal,
      razaoSocial: participante.razaoSocial,
      endereco: participante.endereco,
      contato:
        participante.email || participante.telefone
          ? { email: participante.email, telefone: participante.telefone }
          : undefined,
    };
  }

  /** Converte um registro do catálogo em fornecedor para declaração de serviço tomado. */
  comoFornecedor(participante: Participante): Fornecedor {
    return {
      ...documentoDe(participante.documento),
      inscricaoMunicipal: participante.inscricaoMunicipal,
      razaoSocial: participante.razaoSocial,
      nomeFantasia: participante.nomeFantasia,
      endereco: participante.endereco,
      contato:
        participante.email || participante.telefone
          ? { email: participante.email, telefone: participante.telefone }
          : undefined,
      optanteSimplesNacional: participante.optanteSimplesNacional,
    };
  }

  private salvar(): void {
    mkdirSync(dirname(this.caminho), { recursive: true });
    writeFileSync(this.caminho, `${JSON.stringify(this.dados, null, 2)}\n`);
  }
}

/** Decide entre CPF e CNPJ pelo tamanho do documento. */
export function documentoDe(documento: string): { cpf?: string; cnpj?: string } {
  const digitos = somenteDigitos(documento);
  return digitos.length > 11 ? { cnpj: digitos } : { cpf: digitos };
}

function limpar<T extends object>(objeto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, v]) => v !== undefined && v !== ""),
  ) as Partial<T>;
}
