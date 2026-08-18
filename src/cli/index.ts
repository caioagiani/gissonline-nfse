#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadPortalCredentials,
  type Environment,
  type GissConfig,
} from "../config/index.ts";
import { GissError, PortalError } from "../domain/errors.ts";
import type { Address, CancellationCode, Rps } from "../domain/types.ts";
import { exportPem } from "../infra/certificate.ts";
import { isoDate } from "../infra/xml.ts";
import type { Nfse, QueryResult } from "../messages/parser.ts";
import { GissClient } from "../services/giss-client.ts";
import {
  buildPortalParty,
  PortalService,
  type PartyRole,
} from "../services/portal-service.ts";
import {
  ContactRepository,
  taxIdOf,
  type ContactRole,
} from "../storage/contact-repository.ts";
import { syncFromInvoices } from "../storage/invoice-sync.ts";
import { buildRps, ProfileRepository } from "../storage/profile-repository.ts";
import { validateAgainstSchema } from "../validation/schema-validator.ts";

/** `giss ...` quando instalado; `npm run giss -- ...` dentro do repositório. */
const INVOCATION = process.env["npm_lifecycle_event"] ? "npm run giss --" : "giss";

const HELP = `
giss — cliente dos Web Services GissOnline (NFS-e ABRASF 2.04 + LC 214/2025)

Uso: ${INVOCATION} <comando> [opções]

CERTIFICADO
  cert [--exportar [--out DIR]]        Dados do certificado A1; --exportar grava os PEM

CONSULTAS (serviços prestados)
  ultimas [--limite N] [--meses N]     As N NFS-e mais recentes (padrão: 10, últimos 12 meses)
  prestado --inicio D --fim D          NFS-e emitidas por período de emissão
           [--competencia]               usa período de competência
           [--numero N] [--pagina N] [--todas]
  faixa --de N --ate N [--pagina N]    NFS-e por faixa de numeração
  rps --numero N --serie S [--tipo 1]  NFS-e gerada a partir de um RPS
  lote --protocolo P                   Situação de um lote de RPS

CONSULTAS (serviços tomados)
  tomado --inicio D --fim D            NFS-e em que você é o tomador
         [--competencia] [--numero N] [--pagina N] [--todas]
  comprado-lote --protocolo P          Notas declaradas em um lote (nfsc)
  comprado-protocolo --protocolo P     Situação de um protocolo (nfsc)
  comprado-numero --inicio D --fim D --numero N --serie S

EMISSÃO
  emitir --tomador X --valor V [--descricao T]      Emite NFS-e (GerarNfse)
         [--rps N] [--serie S]                        via RPS quando --rps é informado
         [--competencia D] [--csll V] [--inss V] [--ir V]
         [--item 01.09] [--cnae N] [--nbs N] [--aliquota 3.07]
         [--info T] [--confirmar]
  cancelar --numero N --motivo 1..5 [--confirmar]   Cancela uma NFS-e
  substituir --numero N --motivo 1..5 --tomador X --valor V
             [--descricao T] [--confirmar]          Cancela e reemite

CADASTRO LOCAL
  clientes [--sincronizar --inicio D --fim D]       Lista/atualiza tomadores
  fornecedores [--sincronizar --inicio D --fim D]   Lista/atualiza prestadores
  cliente-add --documento D --nome N [--apelido A] [--im N] [--email E] [--telefone T]
              [--logradouro L --numero N --bairro B --cidade IBGE --uf UF --cep C]
              [--complemento C] [--fantasia F] [--simples 1|2]
  fornecedor-add  (mesmas opções de cliente-add)
  cliente-rm --documento D
  fornecedor-rm --documento D

PORTAL (API REST — cadastro de verdade no GissOnline, via login CPF/senha)
  portal-clientes [--tipo 1|2]                      Cadastro do portal (1=cliente, 2=fornecedor)
  portal-add --documento D --nome N [--tipo 1|2]    Cadastra no portal
             [--fantasia F] [--im N] [--simples] [--mei]
             [--logradouro L --numero N --bairro B --cidade IBGE --uf UF --cep C]
             [--complemento C] [--tipo-logradouro Rua] [--confirmar]
  portal-rm --documento D [--tipo 1|2] [--confirmar] Remove do portal
  portal-importar [--tipo 1|2]                      Traz o cadastro do portal para o local

PERFIL FISCAL
  perfil [--salvar]                    Mostra (ou grava em data/profile.json) os padrões

Opções globais:
  --env producao|homologacao   Ambiente (padrão: GISS_ENV do .env)
  --json | --xml | --debug     Formato de saída / diagnóstico
`;

const options = {
  env: { type: "string" },
  inicio: { type: "string" },
  fim: { type: "string" },
  competencia: { type: "string" },
  numero: { type: "string" },
  serie: { type: "string" },
  tipo: { type: "string" },
  pagina: { type: "string" },
  limite: { type: "string" },
  meses: { type: "string" },
  todas: { type: "boolean", default: false },
  de: { type: "string" },
  ate: { type: "string" },
  protocolo: { type: "string" },
  exportar: { type: "boolean", default: false },
  out: { type: "string" },
  tomador: { type: "string" },
  valor: { type: "string" },
  descricao: { type: "string" },
  info: { type: "string" },
  rps: { type: "string" },
  csll: { type: "string" },
  aliquota: { type: "string" },
  item: { type: "string" },
  cnae: { type: "string" },
  nbs: { type: "string" },
  inss: { type: "string" },
  ir: { type: "string" },
  motivo: { type: "string" },
  confirmar: { type: "boolean", default: false },
  sincronizar: { type: "boolean", default: false },
  documento: { type: "string" },
  nome: { type: "string" },
  fantasia: { type: "string" },
  im: { type: "string" },
  email: { type: "string" },
  telefone: { type: "string" },
  apelido: { type: "string" },
  logradouro: { type: "string" },
  bairro: { type: "string" },
  complemento: { type: "string" },
  cidade: { type: "string" },
  uf: { type: "string" },
  cep: { type: "string" },
  simples: { type: "string" },
  salvar: { type: "boolean", default: false },
  "tipo-logradouro": { type: "string" },
  mei: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  xml: { type: "boolean", default: false },
  debug: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} as const;

type CliValues = ReturnType<
  typeof parseArgs<{ options: typeof options; allowPositionals: true }>
>["values"];

/**
 * Carrega o `.env` do diretório atual quando existe. Instalado como binário
 * global não há `--env-file`, e as credenciais precisam vir de algum lugar;
 * variáveis já definidas no ambiente têm precedência e não são sobrescritas.
 */
function loadDotEnv(): void {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // Node < 20.12 não tem loadEnvFile; nesse caso o .env é ignorado
  }
}

async function main() {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options,
    allowPositionals: true,
  });

  const command = positionals[0];
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  // Comandos de cadastro local e perfil não tocam a rede nem o certificado.
  if (await runLocalCommand(command, values)) return;

  const client = new GissClient({
    environment: values.env as Environment | undefined,
    debug: values.debug,
  });
  const asNumber = (v: string | undefined) => (v === undefined ? undefined : Number(v));

  switch (command) {
    case "cert": {
      const { subject, validFrom, validTo } = client.certificate;
      console.log(`Titular:    ${subject}`);
      console.log(`Válido de:  ${validFrom.toISOString().slice(0, 10)}`);
      console.log(`Válido até: ${validTo.toISOString().slice(0, 10)}`);
      console.log(`Ambiente:   ${client.config.environment}`);
      console.log(`Host:       ${client.config.host}`);
      console.log(
        `Prestador:  CNPJ ${client.config.cnpj} / IM ${client.config.municipalRegistration}`,
      );

      if (values.exportar) {
        const target = values.out ?? dirname(client.config.certificatePath);
        const files = exportPem(client.certificate, target);
        console.log("\nPEM exportado:");
        console.log(`  certificado: ${files.certificate}`);
        console.log(`  chave:       ${files.key}`);
        if (files.chain) console.log(`  cadeia:      ${files.chain}`);
        console.log(`  bundle:      ${files.bundle}`);
        console.log("\nA chave está sem senha — não versione esses arquivos.");
      }
      return;
    }

    case "ultimas": {
      const limit = asNumber(values.limite) ?? 10;
      const months = asNumber(values.meses) ?? 12;
      const to = new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - months);

      const invoices: Nfse[] = [];
      for await (const page of client.paginate((page) =>
        client.nfse.queryProvidedServices({
          issuePeriod: { from: isoDate(from), to: isoDate(to) },
          page,
        }),
      )) {
        invoices.push(...page.invoices);
      }

      // O serviço devolve em ordem crescente; as mais recentes ficam no fim.
      const latest = invoices.slice(-limit).reverse();
      printInvoices({ invoices: latest, warnings: [], xml: "" }, values);
      if (!values.json && !values.xml) {
        console.log(
          `\n${latest.length} de ${invoices.length} nota(s) nos últimos ${months} meses`,
        );
      }
      return;
    }

    case "prestado":
    case "tomado": {
      const taken = command === "tomado";
      const filter = values.numero
        ? { nfseNumber: values.numero }
        : dateFilter(values.inicio, values.fim, Boolean(values.competencia));
      const query = (page: number) =>
        taken
          ? client.nfse.queryTakenServices({ ...filter, page })
          : client.nfse.queryProvidedServices({ ...filter, page });

      if (values.todas && !values.numero) {
        let total = 0;
        for await (const page of client.paginate(query)) {
          total += page.invoices.length;
          printInvoices(page, values, taken);
        }
        if (!values.json && !values.xml) console.log(`\nTotal: ${total} nota(s)`);
        return;
      }

      printInvoices(await query(asNumber(values.pagina) ?? 1), values, taken);
      return;
    }

    case "faixa": {
      if (!values.de || !values.ate) {
        throw new Error("Informe --de e --ate com os números inicial e final");
      }
      printInvoices(
        await client.nfse.queryNfseRange({
          firstNumber: values.de,
          lastNumber: values.ate,
          page: asNumber(values.pagina),
        }),
        values,
      );
      return;
    }

    case "rps": {
      if (!values.numero || !values.serie) {
        throw new Error("Informe --numero e --serie do RPS");
      }
      printInvoices(
        await client.nfse.queryNfseByRps({
          number: values.numero,
          series: values.serie,
          type: values.tipo ? (Number(values.tipo) as 1 | 2 | 3) : undefined,
        }),
        values,
      );
      return;
    }

    case "lote": {
      if (!values.protocolo) throw new Error("Informe --protocolo do lote");
      const result = await client.nfse.queryRpsBatch(values.protocolo);
      if (values.xml) return void console.log(result.xml);
      if (values.json) return void console.log(JSON.stringify(result, null, 2));
      console.log(`Situação: ${result.status} — ${result.statusLabel}`);
      if (result.batchNumber) console.log(`Lote:     ${result.batchNumber}`);
      if (result.receivedAt) console.log(`Recebido: ${result.receivedAt}`);
      printInvoices(result, values);
      return;
    }

    case "comprado-lote": {
      if (!values.protocolo) throw new Error("Informe --protocolo");
      printInvoices(
        await client.nfsc.queryPurchasedByBatch(values.protocolo),
        values,
      );
      return;
    }

    case "comprado-protocolo": {
      if (!values.protocolo) throw new Error("Informe --protocolo");
      const result = await client.nfsc.queryPurchasedByProtocol(values.protocolo);
      if (values.xml) return void console.log(result.xml);
      console.log(`Situação: ${result.status} — ${result.statusLabel}`);
      printInvoices(result, values);
      return;
    }

    case "comprado-numero": {
      if (!values.inicio || !values.fim || !values.numero || !values.serie) {
        throw new Error("Informe --inicio, --fim, --numero e --serie");
      }
      const range = { from: values.inicio, to: values.fim };
      printInvoices(
        await client.nfsc.queryPurchasedByNumber({
          issuePeriod: range,
          competencePeriod: range,
          declaredNumber: values.numero,
          declaredSeries: values.serie,
        }),
        values,
        true,
      );
      return;
    }

    case "emitir": {
      const rps = buildRpsFromCli(values);
      if (!values.confirmar) {
        const preview = client.nfse.previewIssueNfse(rps);
        if (values.xml) return void console.log(preview);
        console.log(issueSummary(values, rps));
        printValidation(preview);
        console.log("\nNada foi enviado. Repita com --confirmar para emitir de verdade.");
        return;
      }
      // GerarNfse e RecepcionarLoteRpsSincrono respondem A01 mesmo com o XML
      // correto; o lote assíncrono é o único caminho que emite. O protocolo é
      // consultado logo em seguida para a emissão parecer síncrona aqui.
      const batchNumber = Number(values.rps ?? Date.now() % 100000);
      const withRps: Rps = rps.identification
        ? rps
        : {
            ...rps,
            identification: {
              number: batchNumber,
              series: values.serie ?? "A",
              type: 1,
            },
            issueDate: new Date(),
            status: 1,
          };

      const protocol = await client.nfse.sendRpsBatch({
        batchNumber,
        rps: [withRps],
      });
      console.log(`Lote aceito. Protocolo: ${protocol.protocol}`);

      const result = await waitForBatch(client, protocol.protocol!);
      if (result.invoices.length === 0) {
        console.log(`Situação: ${result.status} — ${result.statusLabel}`);
        console.log("Nenhuma NFS-e no retorno. Consulte o protocolo acima.");
        return;
      }
      console.log("NFS-e emitida:");
      printInvoices(result, values);
      return;
    }

    case "cancelar": {
      if (!values.numero || !values.motivo) {
        throw new Error("Informe --numero da NFS-e e --motivo (1 a 5)");
      }
      if (!values.confirmar) {
        console.log(
          `Cancelaria a NFS-e ${values.numero} com o motivo ${values.motivo} (${REASONS[values.motivo] ?? "?"}).`,
        );
        console.log("Nada foi enviado. Repita com --confirmar.");
        return;
      }
      const result = await client.nfse.cancelNfse({
        nfseNumber: values.numero,
        cancellationCode: Number(values.motivo) as CancellationCode,
      });
      console.log(`NFS-e ${values.numero} cancelada.`);
      if (result.cancelledAt) console.log(`Data/hora: ${result.cancelledAt}`);
      return;
    }

    case "substituir": {
      if (!values.numero || !values.motivo) {
        throw new Error("Informe --numero da NFS-e substituída e --motivo (1 a 5)");
      }
      const rps = buildRpsFromCli(values);
      if (!values.confirmar) {
        console.log(
          `Substituiria a NFS-e ${values.numero} (motivo ${values.motivo}) por:\n`,
        );
        console.log(issueSummary(values, rps));
        console.log("\nNada foi enviado. Repita com --confirmar.");
        return;
      }
      const result = await client.nfse.replaceNfse(
        {
          nfseNumber: values.numero,
          cancellationCode: Number(values.motivo) as CancellationCode,
        },
        rps,
      );
      console.log(`NFS-e ${values.numero} substituída por:`);
      printInvoices(result, values);
      return;
    }

    case "portal-clientes":
    case "portal-add":
    case "portal-rm":
    case "portal-importar":
      await runPortalCommand(command, values, client.config);
      return;

    case "clientes":
    case "fornecedores": {
      const role: ContactRole = command === "clientes" ? "customer" : "supplier";
      const repository = new ContactRepository();

      if (values.sincronizar) {
        const filter = dateFilter(
          values.inicio,
          values.fim,
          Boolean(values.competencia),
        );
        const invoices: Nfse[] = [];
        const query = (page: number) =>
          role === "customer"
            ? client.nfse.queryProvidedServices({ ...filter, page })
            : client.nfse.queryTakenServices({ ...filter, page });
        for await (const page of client.paginate(query)) {
          invoices.push(...page.invoices);
        }
        const { saved } = syncFromInvoices(repository, role, invoices);
        console.log(
          `${saved} ${roleLabel(role)}(s) sincronizado(s) a partir de ${invoices.length} nota(s).\n`,
        );
      }

      printContacts(repository, role, values);
      return;
    }

    default:
      throw new Error(`Comando desconhecido: ${command}`);
  }
}

/** Rótulo em português para as mensagens ao usuário. */
const roleLabel = (role: ContactRole): string =>
  role === "customer" ? "cliente" : "fornecedor";

/** Aguarda o processamento do lote, que é assíncrono. */
async function waitForBatch(
  client: GissClient,
  protocol: string,
  attempts = 6,
): Promise<Awaited<ReturnType<GissClient["nfse"]["queryRpsBatch"]>>> {
  let last: Awaited<ReturnType<GissClient["nfse"]["queryRpsBatch"]>> | undefined;
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      last = await client.nfse.queryRpsBatch(protocol);
      if (last.invoices.length > 0 || last.status === "3") return last;
    } catch (error) {
      // "Remessa ainda não foi processada" é esperado nas primeiras tentativas
      if (i === attempts - 1) throw error;
    }
  }
  if (!last) throw new Error(`Lote ${protocol} não processado a tempo`);
  return last;
}

const REASONS: Record<string, string> = {
  "1": "erro na emissão",
  "2": "serviço não prestado",
  "3": "erro de assinatura",
  "4": "duplicidade da nota",
  "5": "erro de processamento",
};

/** Comandos que não precisam de rede nem de certificado. */
async function runLocalCommand(
  command: string,
  values: CliValues,
): Promise<boolean> {
  switch (command) {
    case "cliente-add":
    case "fornecedor-add": {
      const role: ContactRole = command === "cliente-add" ? "customer" : "supplier";
      if (!values.documento || !values.nome) {
        throw new Error("Informe --documento e --nome");
      }
      const contact = new ContactRepository().save(role, {
        taxId: values.documento,
        legalName: values.nome,
        tradeName: values.fantasia,
        municipalRegistration: values.im,
        email: values.email,
        phone: values.telefone,
        alias: values.apelido,
        address: buildAddress(values),
        simplesNacionalOptant: values.simples
          ? (Number(values.simples) as 1 | 2)
          : undefined,
      });
      console.log(`${roleLabel(role)} salvo: ${contact.legalName} (${contact.taxId})`);
      if (!contact.address) {
        console.log(
          "Atenção: sem endereço. A emissão de NFS-e exige endereço do tomador.",
        );
      }
      return true;
    }

    case "cliente-rm":
    case "fornecedor-rm": {
      const role: ContactRole = command === "cliente-rm" ? "customer" : "supplier";
      if (!values.documento) throw new Error("Informe --documento");
      const removed = new ContactRepository().remove(role, values.documento);
      console.log(removed ? `${roleLabel(role)} removido.` : `${roleLabel(role)} não encontrado.`);
      return true;
    }

    case "perfil": {
      const repository = new ProfileRepository();
      const profile = repository.load();
      if (values.salvar) console.log(`Perfil gravado em ${repository.save(profile)}`);
      console.log(JSON.stringify(profile, null, 2));
      return true;
    }

    default:
      return false;
  }
}

/** Comandos que falam com a API REST do portal, não com o Web Service. */
async function runPortalCommand(
  command: string,
  values: CliValues,
  config: GissConfig,
): Promise<void> {
  const role = (values.tipo ? Number(values.tipo) : 1) as PartyRole;
  const label = role === 1 ? "cliente" : "fornecedor";
  const portal = await PortalService.authenticate(loadPortalCredentials(config));

  if (command === "portal-clientes") {
    const parties = await portal.list(role);
    if (values.json) return void console.log(JSON.stringify(parties, null, 2));
    for (const party of parties) {
      console.log(
        [party.documento.padEnd(14), party.razaoSocial, party.nomeFantasia ?? ""]
          .filter(Boolean)
          .join("  |  "),
      );
    }
    console.log(`\n${parties.length} ${label}(s) — ${portal.session.legalName}`);
    return;
  }

  if (command === "portal-importar") {
    const repository = new ContactRepository();
    const parties = await portal.list(role);
    for (const party of parties) {
      const full = party.endereco ? party : await portal.get(party.id!);
      repository.save(role === 1 ? "customer" : "supplier", {
        taxId: full.documento,
        legalName: full.razaoSocial,
        tradeName: full.nomeFantasia,
        municipalRegistration: full.inscricaoMunicipal,
        address: full.endereco
          ? {
              street: `${full.endereco.tipoLogradouro} ${full.endereco.logradouro}`.trim(),
              number: full.endereco.numero,
              complement: full.endereco.complemento,
              district: full.endereco.bairro,
              cityCode: String(full.endereco.idIbge),
              state: full.endereco.estado,
              zipCode: full.endereco.cep,
            }
          : undefined,
        source: "portal",
      });
    }
    console.log(`${parties.length} ${label}(s) importado(s) do portal.`);
    return;
  }

  if (command === "portal-rm") {
    if (!values.documento) throw new Error("Informe --documento");
    const existing = await portal.findByTaxId(values.documento, role);
    if (!existing) {
      console.log(`${label} ${values.documento} não está cadastrado no portal.`);
      return;
    }
    if (!values.confirmar) {
      console.log(`Removeria: ${existing.razaoSocial} (${existing.documento})`);
      console.log("Nada foi enviado. Repita com --confirmar.");
      return;
    }
    await portal.remove(await portal.get(existing.id!));
    console.log(`${label} removido do portal: ${existing.razaoSocial}`);
    return;
  }

  // portal-add
  if (!values.documento || !values.nome) {
    throw new Error("Informe --documento e --nome");
  }

  const existing = await portal.findByTaxId(values.documento, role);
  if (existing) {
    console.log(
      `Já cadastrado no portal: ${existing.razaoSocial} (${existing.documento}).`,
    );
    return;
  }

  const address = buildAddress(values);
  const cityName = address ? await portal.cityName(address.cityCode) : undefined;
  const party = buildPortalParty(portal.session, {
    taxId: values.documento,
    legalName: values.nome,
    tradeName: values.fantasia,
    municipalRegistration: values.im,
    role,
    mei: values.mei,
    simplesNacional: values.simples === "1",
    address: address
      ? { ...address, streetType: values["tipo-logradouro"], cityName }
      : undefined,
  });

  if (!values.confirmar) {
    console.log(`Cadastraria no portal (${portal.session.legalName}):\n`);
    console.log(JSON.stringify(party, null, 2));
    console.log("\nNada foi enviado. Repita com --confirmar.");
    return;
  }

  const created = await portal.create(party);
  console.log(`${label} cadastrado no portal: ${created.razaoSocial} (id ${created.id})`);
}

/** Monta o endereço; o XSD exige o grupo completo ou nenhum. */
function buildAddress(values: CliValues): Address | undefined {
  if (!values.logradouro) return undefined;
  const missing = (["bairro", "cidade", "uf", "cep"] as const).filter(
    (field) => !values[field],
  );
  if (missing.length > 0) {
    throw new Error(
      `Endereço incompleto — faltam: ${missing.map((f) => `--${f}`).join(", ")}. ` +
        "--cidade recebe o código IBGE de 7 dígitos.",
    );
  }
  return {
    street: values.logradouro,
    number: values.numero ?? "S/N",
    complement: values.complemento,
    district: values.bairro!,
    cityCode: values.cidade!,
    state: values.uf!.toUpperCase(),
    zipCode: values.cep!.replace(/\D/g, ""),
  };
}

function buildRpsFromCli(values: CliValues): Rps {
  if (!values.tomador || !values.valor) {
    throw new Error("Informe --tomador (documento ou apelido) e --valor");
  }

  const repository = new ContactRepository();
  const contact = repository.find("customer", values.tomador);
  if (!contact) {
    throw new Error(
      `Tomador "${values.tomador}" não está no cadastro local. Use cliente-add, portal-importar ou clientes --sincronizar.`,
    );
  }

  return buildRps(new ProfileRepository().load(), {
    taker: ContactRepository.asServiceTaker(contact),
    serviceAmount: Number(values.valor),
    description: values.descricao,
    competenceDate: values.competencia,
    rpsNumber: values.rps,
    series: values.serie,
    rate: values.aliquota ? Number(values.aliquota) : undefined,
    csll: values.csll ? Number(values.csll) : undefined,
    inss: values.inss ? Number(values.inss) : undefined,
    incomeTax: values.ir ? Number(values.ir) : undefined,
    additionalInformation: values.info,
    profile: {
      ...(values.item ? { serviceListItem: values.item } : {}),
      ...(values.cnae ? { cnaeCode: values.cnae, municipalTaxCode: values.cnae } : {}),
      ...(values.nbs ? { nbsCode: values.nbs } : {}),
    },
  });
}

function issueSummary(values: CliValues, rps: Rps): string {
  const lines = [
    `Tomador:      ${rps.taker?.legalName} (${rps.taker?.cnpj ?? rps.taker?.cpf})`,
    `Valor:        R$ ${Number(values.valor).toFixed(2)}`,
    `Competência:  ${isoDate(rps.competenceDate)}`,
    `Discriminação: ${rps.service.description}`,
    `Item LC 116:  ${rps.service.serviceListItem}`,
    `CNAE:         ${rps.service.cnaeCode ?? "—"}`,
    `NBS:          ${rps.service.nbsCode ?? "—"}`,
    `Alíquota:     ${rps.service.amounts.rate ?? "—"}%`,
    `ISS retido:   ${rps.service.issWithheld === 1 ? "sim" : "não"}`,
  ];
  if (rps.identification) {
    lines.push(
      `RPS:          ${rps.identification.number} série ${rps.identification.series}`,
    );
  }
  return lines.join("\n");
}

function printValidation(xml: string): void {
  const result = validateAgainstSchema(xml, "gerar-nfse-envio-v2_04.xsd");
  if (result === null) {
    console.log("\nSchema: não verificado (xmllint não instalado).");
  } else if (result.valid) {
    console.log("\nSchema: XML válido contra gerar-nfse-envio-v2_04.xsd.");
    for (const d of result.knownDivergences) {
      console.log(`  (divergência conhecida do XSD, ignorada) ${d.slice(0, 90)}`);
    }
  } else {
    console.log("\nSchema: XML INVÁLIDO —");
    for (const error of result.errors) console.log(`  ${error}`);
  }
}

function dateFilter(from: string | undefined, to: string | undefined, byCompetence: boolean) {
  if (!from || !to) {
    throw new Error("Informe --inicio e --fim no formato AAAA-MM-DD (ou use --numero)");
  }
  const range = { from, to };
  return byCompetence ? { competencePeriod: range } : { issuePeriod: range };
}

function printInvoices(
  result: QueryResult,
  values: CliValues,
  showProvider = false,
): void {
  if (values.xml) return void console.log(result.xml);
  if (values.json) return void console.log(JSON.stringify(result.invoices, null, 2));

  for (const warning of result.warnings) {
    console.log(`⚠ [${warning.code}] ${warning.message}`);
  }

  if (result.invoices.length === 0) {
    console.log("Nenhuma NFS-e encontrada.");
    return;
  }

  for (const invoice of result.invoices) {
    const party = showProvider ? invoice.provider : invoice.taker;
    console.log(
      [
        `NFS-e ${invoice.number}`,
        invoice.issueDate?.slice(0, 10),
        party?.legalName ?? party?.taxId ?? "",
        invoice.serviceAmount ? `R$ ${invoice.serviceAmount}` : "",
        invoice.verificationCode,
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }
}

function printContacts(
  repository: ContactRepository,
  role: ContactRole,
  values: CliValues,
): void {
  const contacts = repository.list(role);
  if (values.json) return void console.log(JSON.stringify(contacts, null, 2));

  if (contacts.length === 0) {
    console.log(`Nenhum ${roleLabel(role)} no cadastro local (${repository.path}).`);
    return;
  }

  for (const contact of contacts) {
    const id = taxIdOf(contact.taxId);
    console.log(
      [
        (id.cnpj ?? id.cpf ?? "").padEnd(14),
        contact.legalName,
        contact.alias ? `(${contact.alias})` : "",
        contact.email ?? "",
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }
  console.log(`\n${contacts.length} ${roleLabel(role)}(s) — ${repository.path}`);
}

main().catch((error: unknown) => {
  if (error instanceof GissError) {
    console.error(`\n${error.operation} retornou erro:`);
    for (const message of error.messages) {
      console.error(
        `  [${message.code}] ${message.message}${message.correction ? ` — ${message.correction}` : ""}`,
      );
    }
  } else if (error instanceof PortalError) {
    console.error(`\nAPI do portal: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
