import type { Catalogo, Papel } from "./catalogo.ts";
import type { Nfse } from "./client.ts";
import type { Endereco } from "./types.ts";

/**
 * Alimenta o catálogo local com os participantes que já aparecem nas NFS-e.
 * É a forma de "listar clientes/fornecedores" que o GissOnline permite: o Web
 * Service não expõe cadastro, então a fonte é o histórico de notas.
 */
export function sincronizar(
  catalogo: Catalogo,
  papel: Papel,
  notas: Nfse[],
): { registrados: number; documentos: string[] } {
  const grupo = papel === "cliente" ? "TomadorServico" : "PrestadorServico";
  const documentos = new Set<string>();

  for (const nota of notas) {
    const bloco = primeiro(buscar(nota.bruto, grupo));
    if (!bloco) continue;

    const documento =
      texto(primeiro(buscar(bloco, "Cnpj"))) ?? texto(primeiro(buscar(bloco, "Cpf")));
    const razaoSocial = texto(primeiro(buscar(bloco, "RazaoSocial")));
    if (!documento || !razaoSocial) continue;

    catalogo.registrar(papel, {
      documento,
      razaoSocial,
      inscricaoMunicipal: texto(primeiro(buscar(bloco, "InscricaoMunicipal"))),
      email: texto(primeiro(buscar(bloco, "Email"))),
      telefone: texto(primeiro(buscar(bloco, "Telefone"))),
      endereco: extrairEndereco(bloco),
      origem: `NFS-e ${nota.numero}`,
    });
    documentos.add(documento);
  }

  return { registrados: documentos.size, documentos: [...documentos] };
}

function extrairEndereco(bloco: unknown): Endereco | undefined {
  const registro = (bloco ?? {}) as Record<string, unknown>;
  const endereco = registro["Endereco"];
  if (!endereco || typeof endereco !== "object") return undefined;

  const campos = endereco as Record<string, unknown>;
  const logradouro = texto(campos["Endereco"]);
  const codigoMunicipio = texto(campos["CodigoMunicipio"]);
  const uf = texto(campos["Uf"]);
  const cep = texto(campos["Cep"]);
  if (!logradouro || !codigoMunicipio || !uf || !cep) return undefined;

  return {
    logradouro,
    numero: texto(campos["Numero"]) ?? "S/N",
    complemento: texto(campos["Complemento"]),
    bairro: texto(campos["Bairro"]) ?? "",
    codigoMunicipio,
    uf,
    cep,
  };
}

function buscar(no: unknown, chave: string): unknown[] {
  if (!no || typeof no !== "object") return [];
  const encontrados: unknown[] = [];
  for (const [nome, valor] of Object.entries(no as Record<string, unknown>)) {
    if (nome === chave) {
      encontrados.push(...(Array.isArray(valor) ? valor : [valor]));
    } else {
      encontrados.push(...buscar(valor, chave));
    }
  }
  return encontrados;
}

const primeiro = (valores: unknown[]): unknown => valores[0];

function texto(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || typeof valor === "object") {
    return undefined;
  }
  const resultado = String(valor).trim();
  return resultado === "" ? undefined : resultado;
}
