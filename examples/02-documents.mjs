/**
 * PDF e XML de uma nota emitida.
 *
 *   node --env-file=.env examples/02-documents.mjs
 *
 * Nenhum Web Service gera arquivo: o ABRASF devolve o XML embutido na resposta
 * SOAP, e a representação impressa é do portal. Por isso estes downloads usam
 * a API REST, que pede login de CPF/senha além do certificado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GissClient, PortalService, loadPortalCredentials } from "gissonline-nfse";

// A configuração vai inteira no construtor — nada é lido do ambiente por
// baixo. Numa aplicação estes valores vêm da tabela da empresa; aqui vêm do
// `.env` só para o exemplo rodar.
const company = {
  environment: "producao",
  city: "suzano",                                   // o código IBGE vem daqui
  cnpj: process.env.GISS_CNPJ,
  municipalRegistration: process.env.GISS_ISC_MUNICIPAL,
  certificate: readFileSync(process.env.CERT_PATH), // o .pfx em memória
  certificatePassword: process.env.CERT_PASSWORD,
};

// `config` vem junto porque o login do portal é montado a partir dele.
const { nfse, config } = new GissClient(company);

// O download é pelo id interno da nota — o atributo `Id` de `InfNfse` —,
// não pelo número impresso. Por isso a consulta vem antes.
// A última nota do ano, para o exemplo não depender de um número que só
// existe nesta conta.
const { invoices } = await nfse.queryProvidedServices({
  issuePeriod: { from: "2026-01-01", to: "2026-12-31" },
});
const invoice = invoices.at(-1);
if (!invoice?.internalId) throw new Error("nenhuma nota no período");

console.log(`nota ${invoice.number}  id interno ${invoice.internalId}`);

const portal = await PortalService.authenticate(loadPortalCredentials(config));

const pdf = await portal.invoiceDocument(invoice.internalId);
writeFileSync(`nfse-${invoice.number}.pdf`, pdf);
console.log(`  nfse-${invoice.number}.pdf  ${(pdf.length / 1024).toFixed(1)} KB`);

const xml = await portal.invoiceDocument(invoice.internalId, "xml");
writeFileSync(`nfse-${invoice.number}.xml`, xml);
console.log(`  nfse-${invoice.number}.xml  ${(xml.length / 1024).toFixed(1)} KB`);

// O XML do portal é o mesmo CompNfse que a consulta devolve, mas standalone:
// os namespaces vão no próprio elemento em vez de herdados do envelope SOAP.
// Se a cópia do envelope basta, ela sai da consulta e dispensa login no portal.
const { xml: envelope } = await nfse.queryProvidedServices({
  nfseNumber: invoice.number,
});
console.log(`\nXML do portal:   ${xml.length} bytes (standalone)`);
console.log(`XML do envelope: ${envelope.length} bytes (via SOAP, sem portal)`);
