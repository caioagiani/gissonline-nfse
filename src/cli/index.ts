#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadPortalCredentials,
  resolveCityCode,
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
  lookupParty,
  lookupZip,
  type CompanyLookup,
} from "../services/lookup-service.ts";
import {
  buildPortalParty,
  PortalService,
  type DocumentFormat,
  type PartyRole,
} from "../services/portal-service.ts";
import { MUNICIPALITIES } from "../config/municipalities.ts";
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
giss — GissOnline NFS-e Web Services client (ABRASF 2.04 + LC 214/2025)

Usage: ${INVOCATION} <command> [options]

CERTIFICATE
  cert [--export [--out DIR]]          A1 certificate details; --export writes the PEM files

QUERIES (services provided)
  latest [--limit N] [--months N]      Most recent invoices (default: 10, last 12 months)
  issued --from D --to D               Invoices by issue period
         [--competence]                  use the competence period instead
         [--number N] [--page N] [--all]
  range --first N --last N [--page N]  Invoices by number range
  rps --number N --series S [--type 1] Invoice generated from an RPS
  batch --protocol P                   Status of an RPS batch

QUERIES (services received)
  received --from D --to D             Invoices where you are the customer
           [--competence] [--number N] [--page N] [--all]
  purchased-batch --protocol P         Invoices declared in a batch (nfsc)
  purchased-protocol --protocol P      Status of a protocol (nfsc)
  purchased-number --from D --to D --number N --series S

ISSUING
  issue --customer X --amount V [--description T]   Issues an invoice
        [--rps N] [--series S] [--competence D]
        [--item 01.09] [--cnae N] [--nbs N] [--rate 3.07]
        [--csll V] [--inss V] [--income-tax V] [--notes T] [--confirm]
  cancel --number N --reason 1..5 [--confirm]       Cancels an invoice
  replace --number N --reason 1..5 --customer X --amount V
          [--description T] [--confirm]             Cancels and reissues

DOCUMENTS (portal REST — the Web Service issues no files)
  pdf --number N [--out DIR|FILE]                   Downloads the invoice PDF
  xml --number N [--out DIR|FILE]                   Downloads the invoice XML

LOCAL DIRECTORY
  customers [--sync --from D --to D]                Lists/updates customers
  suppliers [--sync --from D --to D]                Lists/updates suppliers
  customer-add --tax-id D --name N [--alias A] [--registration N] [--email E] [--phone T]
               [--street L --number N --district B --city IBGE --state UF --zip C]
               [--complement C] [--trade-name F] [--simples 1|2]
  supplier-add  (same options as customer-add)
  customer-rm --tax-id D
  supplier-rm --tax-id D

PORTAL (REST API — the actual GissOnline directory, via CPF/password login)
  portal-list [--type 1|2]                          Portal directory (1=customer, 2=supplier)
  portal-add --tax-id D --name N [--type 1|2]       Registers in the portal
             [--trade-name F] [--registration N] [--simples] [--mei]
             [--street L --number N --district B --city IBGE --state UF --zip C]
             [--complement C] [--street-type Rua] [--confirm]
  portal-rm --tax-id D [--type 1|2] [--confirm]     Removes from the portal
  portal-import [--type 1|2]                        Imports the portal directory locally

LOOKUPS (BrasilAPI — convenience, not a source of truth)
  zip <cep>                            Street, district, city and state for a postal code
  cnpj <cnpj>                          Company details, address and IBGE code

  Both customer-add and portal-add accept --lookup, which fills the missing
  fields from the CNPJ before registering. Anything you pass explicitly wins.

MUNICIPALITIES
  cities [--state SP]                               Cities known to publish the Web Service

MUNICIPAL ACTIVITIES (the source of CodigoTributacaoMunicipio)
  activities [term] [--item 1.09] [--city IBGE]     City activity table (no login)
             [--company] [--date YYYY-MM-DD]        Only the ones your company is bound to

TAX PROFILE
  profile [--save]                     Shows (or writes to data/profile.json) the defaults

Global options:
  --env producao|homologacao   Environment (default: GISS_ENV from .env)
  --json | --xml | --debug     Output format / diagnostics
`;

const options = {
  env: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  competence: { type: "string" },
  number: { type: "string" },
  series: { type: "string" },
  type: { type: "string" },
  page: { type: "string" },
  limit: { type: "string" },
  months: { type: "string" },
  all: { type: "boolean", default: false },
  first: { type: "string" },
  last: { type: "string" },
  protocol: { type: "string" },
  export: { type: "boolean", default: false },
  out: { type: "string" },
  customer: { type: "string" },
  amount: { type: "string" },
  description: { type: "string" },
  notes: { type: "string" },
  rps: { type: "string" },
  csll: { type: "string" },
  rate: { type: "string" },
  item: { type: "string" },
  cnae: { type: "string" },
  nbs: { type: "string" },
  inss: { type: "string" },
  "income-tax": { type: "string" },
  reason: { type: "string" },
  confirm: { type: "boolean", default: false },
  sync: { type: "boolean", default: false },
  "tax-id": { type: "string" },
  name: { type: "string" },
  "trade-name": { type: "string" },
  registration: { type: "string" },
  email: { type: "string" },
  phone: { type: "string" },
  alias: { type: "string" },
  state: { type: "string" },
  street: { type: "string" },
  district: { type: "string" },
  complement: { type: "string" },
  city: { type: "string" },
  zip: { type: "string" },
  simples: { type: "string" },
  company: { type: "boolean", default: false },
  date: { type: "string" },
  save: { type: "boolean", default: false },
  "street-type": { type: "string" },
  mei: { type: "boolean", default: false },
  lookup: { type: "boolean", default: false },
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
  if (await runLocalCommand(command, values, positionals)) return;

  // A tabela de atividades vem do portal, não do Web Service: pede município,
  // não certificado. Fica antes do cliente SOAP para não exigir o .pfx.
  if (command === "activities") {
    await runActivitiesCommand(values, positionals);
    return;
  }

  const client = new GissClient({
    environment: values.env as Environment | undefined,
    debug: values.debug,
  });
  const asNumber = (v: string | undefined) => (v === undefined ? undefined : Number(v));

  switch (command) {
    case "cert": {
      const { subject, validFrom, validTo } = client.certificate;
      console.log(`Holder:      ${subject}`);
      console.log(`Valid from:  ${validFrom.toISOString().slice(0, 10)}`);
      console.log(`Valid until: ${validTo.toISOString().slice(0, 10)}`);
      console.log(`Environment: ${client.config.environment}`);
      console.log(`Host:        ${client.config.host}`);
      console.log(
        `Provider:    CNPJ ${client.config.cnpj} / IM ${client.config.municipalRegistration}`,
      );

      if (values.export) {
        const target = values.out ?? dirname(client.config.certificatePath);
        const files = exportPem(client.certificate, target);
        console.log("\nPEM files written:");
        console.log(`  certificate: ${files.certificate}`);
        console.log(`  key:         ${files.key}`);
        if (files.chain) console.log(`  chain:       ${files.chain}`);
        console.log(`  bundle:      ${files.bundle}`);
        console.log("\nThe key has no passphrase — keep these files out of version control.");
      }
      return;
    }

    case "latest": {
      const limit = asNumber(values.limit) ?? 10;
      const months = asNumber(values.months) ?? 12;
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
          `\n${latest.length} of ${invoices.length} invoice(s) in the last ${months} months`,
        );
      }
      return;
    }

    case "issued":
    case "received": {
      const taken = command === "received";
      const filter = values.number
        ? { nfseNumber: values.number }
        : dateFilter(values.from, values.to, Boolean(values.competence));
      const query = (page: number) =>
        taken
          ? client.nfse.queryTakenServices({ ...filter, page })
          : client.nfse.queryProvidedServices({ ...filter, page });

      if (values.all && !values.number) {
        let total = 0;
        for await (const page of client.paginate(query)) {
          total += page.invoices.length;
          printInvoices(page, values, taken);
        }
        if (!values.json && !values.xml) console.log(`\nTotal: ${total} invoice(s)`);
        return;
      }

      printInvoices(await query(asNumber(values.page) ?? 1), values, taken);
      return;
    }

    case "range": {
      if (!values.first || !values.last) {
        throw new Error("Provide --first and --last with the invoice number range");
      }
      printInvoices(
        await client.nfse.queryNfseRange({
          firstNumber: values.first,
          lastNumber: values.last,
          page: asNumber(values.page),
        }),
        values,
      );
      return;
    }

    case "rps": {
      if (!values.number || !values.series) {
        throw new Error("Provide the RPS --number and --series");
      }
      printInvoices(
        await client.nfse.queryNfseByRps({
          number: values.number,
          series: values.series,
          type: values.type ? (Number(values.type) as 1 | 2 | 3) : undefined,
        }),
        values,
      );
      return;
    }

    case "batch": {
      if (!values.protocol) throw new Error("Provide the batch --protocol");
      const result = await client.nfse.queryRpsBatch(values.protocol);
      if (values.xml) return void console.log(result.xml);
      if (values.json) return void console.log(JSON.stringify(result, null, 2));
      console.log(`Status:   ${result.status} — ${result.statusLabel}`);
      if (result.batchNumber) console.log(`Batch:    ${result.batchNumber}`);
      if (result.receivedAt) console.log(`Received: ${result.receivedAt}`);
      printInvoices(result, values);
      return;
    }

    case "purchased-batch": {
      if (!values.protocol) throw new Error("Provide the --protocol");
      printInvoices(
        await client.nfsc.queryPurchasedByBatch(values.protocol),
        values,
      );
      return;
    }

    case "purchased-protocol": {
      if (!values.protocol) throw new Error("Provide the --protocol");
      const result = await client.nfsc.queryPurchasedByProtocol(values.protocol);
      if (values.xml) return void console.log(result.xml);
      console.log(`Status:   ${result.status} — ${result.statusLabel}`);
      printInvoices(result, values);
      return;
    }

    case "purchased-number": {
      if (!values.from || !values.to || !values.number || !values.series) {
        throw new Error("Provide --from, --to, --number and --series");
      }
      const range = { from: values.from, to: values.to };
      printInvoices(
        await client.nfsc.queryPurchasedByNumber({
          issuePeriod: range,
          competencePeriod: range,
          declaredNumber: values.number,
          declaredSeries: values.series,
        }),
        values,
        true,
      );
      return;
    }

    case "issue": {
      const rps = buildRpsFromCli(values);
      if (!values.confirm) {
        const preview = client.nfse.previewIssueNfse(rps);
        if (values.xml) return void console.log(preview);
        console.log(issueSummary(values, rps));
        printValidation(preview);
        console.log("\nNothing was sent. Repeat with --confirm to actually issue.");
        return;
      }
      // GerarNfse e RecepcionarLoteRpsSincrono respondem A01 mesmo com o XML
      // correto; o lote assíncrono é o único caminho que emite. `issueRps`
      // cuida do protocolo e da espera, e é ele que garante que repetir o
      // comando com o mesmo --rps não gere uma segunda nota.
      const rpsNumber = values.rps ?? String(Date.now() % 100000);
      if (!values.rps) {
        console.log(
          `RPS ${rpsNumber} (generated). Pass --rps to make a retry safe to repeat.`,
        );
      }

      const withRps: Rps = rps.identification
        ? rps
        : {
            ...rps,
            identification: {
              number: rpsNumber,
              series: values.series ?? "A",
              type: 1,
            },
            issueDate: new Date(),
            status: 1,
          };

      const outcome = await client.nfse.issueRps(withRps);

      if (outcome.status === "already-issued") {
        console.log("This RPS had already been issued:");
        printInvoices({ invoices: [outcome.invoice!], warnings: [], xml: "" }, values);
        return;
      }
      if (outcome.invoice) {
        console.log("Invoice issued:");
        printInvoices(
          { invoices: [outcome.invoice], warnings: outcome.warnings, xml: "" },
          values,
        );
        return;
      }

      for (const warning of outcome.warnings) {
        console.log(`⚠ [${warning.code}] ${warning.message}`);
      }
      console.log(
        outcome.status === "rejected"
          ? `Rejected. Protocol: ${outcome.protocol}`
          : `Still processing. Query it with: ${INVOCATION} batch --protocol ${outcome.protocol}`,
      );
      console.log(
        `Repeating with --rps ${rpsNumber} is safe: an already-issued RPS is not issued twice.`,
      );
      return;
    }

    case "cancel": {
      if (!values.number || !values.reason) {
        throw new Error("Provide the invoice --number and --reason (1 to 5)");
      }
      if (!values.confirm) {
        console.log(
          `Would cancel invoice ${values.number}, reason ${values.reason} (${REASONS[values.reason] ?? "?"}).`,
        );
        console.log("Nothing was sent. Repeat with --confirm.");
        return;
      }
      const result = await client.nfse.cancelNfse({
        nfseNumber: values.number,
        cancellationCode: Number(values.reason) as CancellationCode,
      });
      console.log(`Invoice ${values.number} cancelled.`);
      if (result.cancelledAt) console.log(`Timestamp: ${result.cancelledAt}`);
      return;
    }

    case "replace": {
      if (!values.number || !values.reason) {
        throw new Error("Provide the replaced invoice --number and --reason (1 to 5)");
      }
      const rps = buildRpsFromCli(values);
      if (!values.confirm) {
        console.log(
          `Would replace invoice ${values.number} (reason ${values.reason}) with:\n`,
        );
        console.log(issueSummary(values, rps));
        console.log("\nNothing was sent. Repeat with --confirm.");
        return;
      }
      const result = await client.nfse.replaceNfse(
        {
          nfseNumber: values.number,
          cancellationCode: Number(values.reason) as CancellationCode,
        },
        rps,
      );
      console.log(`Invoice ${values.number} replaced by:`);
      printInvoices(result, values);
      return;
    }

    case "pdf":
    case "xml": {
      if (!values.number) throw new Error("Provide the invoice --number");

      // O arquivo é identificado pelo id interno da nota, que só a consulta
      // conhece — o número impresso não serve na rota do portal.
      const { invoices } = await client.nfse.queryProvidedServices({
        nfseNumber: values.number,
      });
      const invoice = invoices[0];
      if (!invoice) throw new Error(`Invoice ${values.number} was not found`);
      if (!invoice.internalId) {
        throw new Error(`Invoice ${values.number} has no internal id to download`);
      }

      const portal = await PortalService.authenticate(loadPortalCredentials(client.config));
      const file = await portal.invoiceDocument(invoice.internalId, command);
      const target = documentTarget(values.out, invoice.number, command);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file);

      console.log(`Invoice ${invoice.number}  |  ${invoice.taker?.legalName ?? ""}`);
      console.log(`${target}  (${(file.length / 1024).toFixed(1)} KB)`);
      return;
    }

    case "portal-list":
    case "portal-add":
    case "portal-rm":
    case "portal-import":
      await runPortalCommand(command, values, client.config);
      return;

    case "customers":
    case "suppliers": {
      const role: ContactRole = command === "customers" ? "customer" : "supplier";
      const repository = new ContactRepository();

      if (values.sync) {
        const filter = dateFilter(
          values.from,
          values.to,
          Boolean(values.competence),
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
          `${saved} ${roleLabel(role)}(s) synced from ${invoices.length} invoice(s).\n`,
        );
      }

      printContacts(repository, role, values);
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/** Rótulo em português para as mensagens ao usuário. */
const roleLabel = (role: ContactRole): string =>
  role === "customer" ? "customer" : "supplier";

/** Aguarda o processamento do lote, que é assíncrono. */

const REASONS: Record<string, string> = {
  "1": "issuing error",
  "2": "service not provided",
  "3": "signature error",
  "4": "duplicate invoice",
  "5": "processing error",
};

/** Comandos que não precisam de rede nem de certificado. */
async function runLocalCommand(
  command: string,
  values: CliValues,
  positionals: string[],
): Promise<boolean> {
  // eslint-disable-next-line no-param-reassign -- --lookup enriches the input
  switch (command) {
    case "customer-add":
    case "supplier-add": {
      const role: ContactRole = command === "customer-add" ? "customer" : "supplier";
      values = await withLookup(values);
      if (!values["tax-id"] || !values.name) {
        throw new Error("Provide --tax-id and --name");
      }
      const contact = new ContactRepository().save(role, {
        taxId: values["tax-id"],
        legalName: values.name,
        tradeName: values["trade-name"],
        municipalRegistration: values.registration,
        email: values.email,
        phone: values.phone,
        alias: values.alias,
        address: buildAddress(values),
        simplesNacionalOptant: values.simples
          ? (Number(values.simples) as 1 | 2)
          : undefined,
      });
      console.log(`${roleLabel(role)} saved: ${contact.legalName} (${contact.taxId})`);
      if (!contact.address) {
        console.log(
          "Warning: no address. Issuing an invoice requires the customer address.",
        );
      }
      return true;
    }

    case "customer-rm":
    case "supplier-rm": {
      const role: ContactRole = command === "customer-rm" ? "customer" : "supplier";
      if (!values["tax-id"]) throw new Error("Provide --tax-id");
      const removed = new ContactRepository().remove(role, values["tax-id"]);
      console.log(removed ? `${roleLabel(role)} removed.` : `${roleLabel(role)} not found.`);
      return true;
    }

    case "zip": {
      const code = positionals[1] ?? values.zip;
      if (!code) throw new Error("Provide the postal code: giss zip 01310-100");
      const found = await lookupZip(code);
      if (values.json) return void console.log(JSON.stringify(found, null, 2)), true;
      console.log(`  zip:      ${found.zipCode}`);
      console.log(`  street:   ${found.street ?? "—"}`);
      console.log(`  district: ${found.district ?? "—"}`);
      console.log(`  city:     ${found.city}/${found.state}`);
      return true;
    }

    case "cnpj": {
      const taxId = positionals[1] ?? values["tax-id"];
      if (!taxId) throw new Error("Provide the CNPJ: giss cnpj 00000000000191");
      const found = await lookupParty(taxId);
      if (values.json) return void console.log(JSON.stringify(found, null, 2)), true;
      console.log(`  name:      ${found.legalName}`);
      if (found.tradeName) console.log(`  trade:     ${found.tradeName}`);
      console.log(`  status:    ${found.status ?? "—"}${found.simplesNacionalOptant ? " · Simples Nacional" : ""}`);
      console.log(`  address:   ${[found.street, found.number].filter(Boolean).join(", ") || "—"}`);
      if (found.complement) console.log(`  complement:${found.complement}`);
      console.log(`  district:  ${found.district ?? "—"}`);
      console.log(`  city:      ${found.city}/${found.state}  IBGE ${found.cityCode ?? "—"}`);
      console.log(`  zip:       ${found.zipCode ?? "—"}`);
      if (found.email) console.log(`  email:     ${found.email}`);
      if (found.phone) console.log(`  phone:     ${found.phone}`);
      console.log(`\n  giss customer-add --tax-id ${found.taxId} --lookup`);
      return true;
    }

    case "cities": {
      const state = values.state?.toUpperCase();
      const list = state
        ? MUNICIPALITIES.filter((m) => m.state === state)
        : MUNICIPALITIES;

      if (values.json) return void console.log(JSON.stringify(list, null, 2)), true;
      for (const city of list) {
        console.log(
          `${city.slug.padEnd(18)} ${city.cityCode}  ${city.name}/${city.state}`,
        );
      }
      console.log(`\n${list.length} municipalit${list.length === 1 ? "y" : "ies"}`);
      console.log("Set GISS_MUNICIPIO to the first column; the IBGE code follows from it.");
      return true;
    }

    case "profile": {
      const repository = new ProfileRepository();
      const profile = repository.load();
      if (values.save) console.log(`Profile written to ${repository.save(profile)}`);
      console.log(JSON.stringify(profile, null, 2));
      return true;
    }

    default:
      return false;
  }
}

/**
 * Aceita um diretório ou o caminho completo do arquivo em `--out`; sem nada,
 * grava no diretório atual com o número da nota no nome.
 */
function documentTarget(
  out: string | undefined,
  number: string,
  format: DocumentFormat,
): string {
  const name = `nfse-${number}.${format}`;
  if (!out) return resolve(process.cwd(), name);
  return out.toLowerCase().endsWith(`.${format}`) ? resolve(out) : resolve(out, name);
}

/** Comandos que falam com a API REST do portal, não com o Web Service. */
/**
 * Lista a tabela de atividades do município, ou só as da empresa.
 *
 * O `CodigoTributacaoMunicipio` não existe no WSDL — nenhuma das 16 operações
 * devolve tabela de apoio —, então a origem é a API REST do portal. A lista da
 * cidade é pública; a da empresa exige o login do portal.
 */
async function runActivitiesCommand(
  values: CliValues,
  positionals: string[],
): Promise<void> {
  const cityCode = resolveCityCode(undefined, values.city);

  const activities = values.company
    ? await (
        await PortalService.authenticate(
          loadPortalCredentials({ cityCode, cnpj: process.env.GISS_CNPJ }),
        )
      ).companyActivities(values.date ?? new Date())
    : await PortalService.listActivities(cityCode);

  // O item da LC 116 muda de forma conforme a cidade: Suzano grava `1.09`,
  // Guarulhos grava `101` para 1.01. Comparar só os dígitos faz `--item 1.09`
  // valer nas duas.
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+/, "");
  const term = positionals[1]?.toLowerCase();
  const item = values.item ? digits(values.item) : undefined;
  const found = activities.filter(
    (activity) =>
      (!term ||
        activity.code.includes(term) ||
        activity.description.toLowerCase().includes(term)) &&
      (!item || digits(activity.serviceListItem) === item),
  );

  if (values.json) return void console.log(JSON.stringify(found, null, 2));

  const width = Math.max(4, ...found.map((a) => a.code.length));
  for (const activity of found) {
    console.log(
      [
        activity.code.padEnd(width),
        activity.serviceListItem.padEnd(6),
        activity.rate === undefined ? "" : `${activity.rate.toFixed(2)}%`.padStart(7),
        activity.description,
      ]
        .filter(Boolean)
        .join("  "),
    );
  }

  const scope = values.company ? "bound to the company" : `in city ${cityCode}`;
  console.log(`\n${found.length} of ${activities.length} activity(ies) ${scope}`);
  console.log(
    "The rate above is the municipal one — under Simples Nacional the annex rate applies.",
  );
}

async function runPortalCommand(
  command: string,
  values: CliValues,
  config: GissConfig,
): Promise<void> {
  // eslint-disable-next-line no-param-reassign -- --lookup enriches the input
  const role = (values.type ? Number(values.type) : 1) as PartyRole;
  const label = role === 1 ? "customer" : "supplier";
  const portal = await PortalService.authenticate(loadPortalCredentials(config));

  if (command === "portal-list") {
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

  if (command === "portal-import") {
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
    console.log(`${parties.length} ${label}(s) imported from the portal.`);
    return;
  }

  if (command === "portal-rm") {
    if (!values["tax-id"]) throw new Error("Provide --tax-id");
    const existing = await portal.findByTaxId(values["tax-id"], role);
    if (!existing) {
      console.log(`${label} ${values["tax-id"]} is not registered in the portal.`);
      return;
    }
    if (!values.confirm) {
      console.log(`Would remove: ${existing.razaoSocial} (${existing.documento})`);
      console.log("Nothing was sent. Repeat with --confirm.");
      return;
    }
    await portal.remove(await portal.get(existing.id!));
    console.log(`${label} removed from the portal: ${existing.razaoSocial}`);
    return;
  }

  // portal-add
  values = await withLookup(values);
  if (!values["tax-id"] || !values.name) {
    throw new Error("Provide --tax-id and --name");
  }

  const existing = await portal.findByTaxId(values["tax-id"], role);
  if (existing) {
    console.log(
      `Already registered in the portal: ${existing.razaoSocial} (${existing.documento}).`,
    );
    return;
  }

  const address = buildAddress(values);
  const cityName = address ? await portal.cityName(address.cityCode) : undefined;
  const party = buildPortalParty(portal.session, {
    taxId: values["tax-id"],
    legalName: values.name,
    tradeName: values["trade-name"],
    municipalRegistration: values.registration,
    role,
    mei: values.mei,
    simplesNacional: values.simples === "1",
    email: values.email,
    phone: values.phone,
    address: address
      ? { ...address, streetType: values["street-type"], cityName }
      : undefined,
  });

  if (!values.confirm) {
    console.log(`Would register in the portal (${portal.session.legalName}):\n`);
    console.log(JSON.stringify(party, null, 2));
    console.log("\nNothing was sent. Repeat with --confirm.");
    return;
  }

  const created = await portal.create(party);
  console.log(`${label} registered in the portal: ${created.razaoSocial} (id ${created.id})`);
}

/**
 * Fills the gaps from the CNPJ registry. Anything passed explicitly wins — the
 * lookup only supplies what the command line left out.
 */
async function withLookup(values: CliValues): Promise<CliValues> {
  if (!values.lookup) return values;
  const taxId = values["tax-id"];
  if (!taxId) throw new Error("--lookup needs --tax-id");

  const found: CompanyLookup = await lookupParty(taxId);
  console.log(`Looked up ${found.legalName}${found.status ? ` (${found.status})` : ""}`);

  const filled = { ...values } as Record<string, unknown>;
  const fill = (key: string, value: string | undefined) => {
    if (value && !filled[key]) filled[key] = value;
  };

  fill("name", found.legalName);
  fill("trade-name", found.tradeName);
  fill("street", found.street);
  fill("number", found.number);
  fill("complement", found.complement);
  fill("district", found.district);
  fill("city", found.cityCode);
  fill("state", found.state);
  fill("zip", found.zipCode);
  fill("email", found.email);
  fill("phone", found.phone);
  if (found.simplesNacionalOptant && !filled["simples"]) filled["simples"] = "1";

  return filled as CliValues;
}

/** Monta o endereço; o XSD exige o grupo completo ou nenhum. */
function buildAddress(values: CliValues): Address | undefined {
  if (!values.street) return undefined;
  const missing = (["district", "city", "state", "zip"] as const).filter(
    (field) => !values[field],
  );
  if (missing.length > 0) {
    throw new Error(
      `Incomplete address — missing: ${missing.map((f) => `--${f}`).join(", ")}. ` +
        "--city takes the 7-digit IBGE code.",
    );
  }
  return {
    street: values.street,
    number: values.number ?? "S/N",
    complement: values.complement,
    district: values.district!,
    cityCode: values.city!,
    state: values.state!.toUpperCase(),
    zipCode: values.zip!.replace(/\D/g, ""),
  };
}

function buildRpsFromCli(values: CliValues): Rps {
  if (!values.customer || !values.amount) {
    throw new Error("Provide --customer (tax id or alias) and --amount");
  }

  const repository = new ContactRepository();
  const contact = repository.find("customer", values.customer);
  if (!contact) {
    throw new Error(
      `Customer "${values.customer}" is not in the local directory. Use customer-add, portal-import or customers --sync.`,
    );
  }

  return buildRps(new ProfileRepository().load(), {
    taker: ContactRepository.asServiceTaker(contact),
    serviceAmount: Number(values.amount),
    description: values.description,
    competenceDate: values.competence,
    rpsNumber: values.rps,
    series: values.series,
    rate: values.rate ? Number(values.rate) : undefined,
    csll: values.csll ? Number(values.csll) : undefined,
    inss: values.inss ? Number(values.inss) : undefined,
    incomeTax: values["income-tax"] ? Number(values["income-tax"]) : undefined,
    additionalInformation: values.notes,
    profile: {
      ...(values.item ? { serviceListItem: values.item } : {}),
      ...(values.cnae ? { cnaeCode: values.cnae, municipalTaxCode: values.cnae } : {}),
      ...(values.nbs ? { nbsCode: values.nbs } : {}),
    },
  });
}

function issueSummary(values: CliValues, rps: Rps): string {
  const lines = [
    `Customer:      ${rps.taker?.legalName} (${rps.taker?.cnpj ?? rps.taker?.cpf})`,
    `Amount:        R$ ${Number(values.amount).toFixed(2)}`,
    `Competence:    ${isoDate(rps.competenceDate)}`,
    `Description:   ${rps.service.description}`,
    `LC 116 item:   ${rps.service.serviceListItem}`,
    `CNAE:          ${rps.service.cnaeCode ?? "—"}`,
    `NBS:           ${rps.service.nbsCode ?? "—"}`,
    `Rate:          ${rps.service.amounts.rate ?? "—"}%`,
    `ISS withheld:  ${rps.service.issWithheld === 1 ? "yes" : "no"}`,
  ];
  if (rps.identification) {
    lines.push(
      `RPS:           ${rps.identification.number} series ${rps.identification.series}`,
    );
  }
  return lines.join("\n");
}

function printValidation(xml: string): void {
  const result = validateAgainstSchema(xml, "gerar-nfse-envio-v2_04.xsd");
  if (result === null) {
    console.log("\nSchema: not checked (xmllint not installed).");
  } else if (result.valid) {
    console.log("\nSchema: XML valid against gerar-nfse-envio-v2_04.xsd.");
    for (const d of result.knownDivergences) {
      console.log(`  (known XSD divergence, ignored) ${d.slice(0, 90)}`);
    }
  } else {
    console.log("\nSchema: XML INVALID —");
    for (const error of result.errors) console.log(`  ${error}`);
  }
}

function dateFilter(from: string | undefined, to: string | undefined, byCompetence: boolean) {
  if (!from || !to) {
    throw new Error("Provide --from and --to as YYYY-MM-DD (or use --number)");
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
    console.log("No invoice found.");
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
    console.log(`No ${roleLabel(role)} in the local directory (${repository.path}).`);
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
    console.error(`\n${error.operation} returned an error:`);
    for (const message of error.messages) {
      console.error(
        `  [${message.code}] ${message.message}${message.correction ? ` — ${message.correction}` : ""}`,
      );
    }
  } else if (error instanceof PortalError) {
    console.error(`\nPortal API: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
