import type { Address } from "../domain/types.ts";
import type { Nfse } from "../messages/parser.ts";
import type { ContactRepository, ContactRole } from "./contact-repository.ts";

/**
 * Alimenta o cadastro local com os participantes que já aparecem nas NFS-e.
 * É a forma de "listar clientes/fornecedores" que o Web Service permite: como
 * ele não expõe cadastro, a fonte é o histórico de notas.
 */
export function syncFromInvoices(
  repository: ContactRepository,
  role: ContactRole,
  invoices: Nfse[],
): { saved: number; taxIds: string[] } {
  const groupName = role === "customer" ? "TomadorServico" : "PrestadorServico";
  const taxIds = new Set<string>();

  for (const invoice of invoices) {
    const block = findAll(invoice.raw, groupName)[0];
    if (!block) continue;

    const taxId =
      asText(findAll(block, "Cnpj")[0]) ?? asText(findAll(block, "Cpf")[0]);
    const legalName = asText(findAll(block, "RazaoSocial")[0]);
    if (!taxId || !legalName) continue;

    repository.save(role, {
      taxId,
      legalName,
      municipalRegistration: asText(findAll(block, "InscricaoMunicipal")[0]),
      email: asText(findAll(block, "Email")[0]),
      phone: asText(findAll(block, "Telefone")[0]),
      address: extractAddress(block),
      source: `NFS-e ${invoice.number}`,
    });
    taxIds.add(taxId);
  }

  return { saved: taxIds.size, taxIds: [...taxIds] };
}

function extractAddress(block: unknown): Address | undefined {
  const record = (block ?? {}) as Record<string, unknown>;
  const address = record["Endereco"];
  if (!address || typeof address !== "object") return undefined;

  const fields = address as Record<string, unknown>;
  const street = asText(fields["Endereco"]);
  const cityCode = asText(fields["CodigoMunicipio"]);
  const state = asText(fields["Uf"]);
  const zipCode = asText(fields["Cep"]);
  if (!street || !cityCode || !state || !zipCode) return undefined;

  return {
    street,
    number: asText(fields["Numero"]) ?? "S/N",
    complement: asText(fields["Complemento"]),
    district: asText(fields["Bairro"]) ?? "",
    cityCode,
    state,
    zipCode,
  };
}

function findAll(node: unknown, key: string): unknown[] {
  if (!node || typeof node !== "object") return [];
  const found: unknown[] = [];
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    if (name === key) found.push(...(Array.isArray(value) ? value : [value]));
    else found.push(...findAll(value, key));
  }
  return found;
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null || typeof value === "object") {
    return undefined;
  }
  const text = String(value).trim();
  return text === "" ? undefined : text;
}
