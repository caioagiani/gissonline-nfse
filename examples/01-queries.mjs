/**
 * Consultas — o caminho mais curto para ver o cliente funcionando.
 *
 *   node --env-file=.env examples/01-queries.mjs
 *
 * Só lê. Nada aqui emite, cancela ou altera nota.
 */
import { readFileSync } from "node:fs";
import { GissClient } from "gissonline-nfse";

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

// `nfse` e `nfsc` são os dois Web Services; `paginate` percorre as páginas.
const { nfse, paginate } = new GissClient(company);

// Não há login nem token em lugar nenhum: a identidade é o certificado A1,
// apresentado no handshake TLS de cada chamada. Sem ele o serviço responde
// `400 No required SSL certificate was sent` e não conversa.

// Desestruturar o serviço funciona; desestruturar um método dele, não — os
// métodos usam `this` para alcançar o certificado e o host. Se precisar de um
// método solto: `giss.nfse.queryProvidedServices.bind(giss.nfse)`.
//
// `paginate` sobrevive porque não usa `this`: só chama a função que recebe.
// Guarde o cliente inteiro se for precisar de `config` ou `certificate`.

// 1. Por período de emissão -------------------------------------------------
const july = await nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});
console.log(`julho: ${july.invoices.length} nota(s)`);
for (const invoice of july.invoices) {
  const date = invoice.issueDate?.slice(0, 10);
  const taker = invoice.taker?.legalName ?? "";
  console.log(`  ${invoice.number}  ${date}  R$ ${invoice.serviceAmount}  ${taker}`);
}

// 2. Uma nota específica ----------------------------------------------------
// O número sai da consulta acima para o exemplo rodar em qualquer conta.
const number = july.invoices.at(-1)?.number;
const { invoices } = await nfse.queryProvidedServices({ nfseNumber: number });
const [invoice] = invoices;
if (invoice) {
  console.log(`\nnota ${invoice.number}`);
  console.log(`  verificação: ${invoice.verificationCode}`);
  console.log(`  competência: ${invoice.competenceDate?.slice(0, 10)}`);
  console.log(`  ISS:         R$ ${invoice.issAmount}`);
  console.log(`  id interno:  ${invoice.internalId}   ← usado para baixar o PDF`);
}

// 3. Por faixa de numeração -------------------------------------------------
const first = july.invoices[0]?.number;
const last = july.invoices.at(-1)?.number;
const range = await nfse.queryNfseRange({ firstNumber: first, lastNumber: last });
console.log(`\nfaixa ${first}–${last}: ${range.invoices.length} nota(s)`);

// 4. Pelo RPS que originou a nota -------------------------------------------
// Cada nota traz o RPS que a originou em `invoice.rps` — mas só as emitidas
// pelo Web Service: as lançadas à mão no portal não passam por RPS nenhum.
// `findByRps` faz o caminho inverso, e responde `undefined` quando o número
// ainda não virou nota.
const year = await nfse.queryProvidedServices({
  issuePeriod: { from: "2026-01-01", to: "2026-12-31" },
});
const fromRps = year.invoices.filter((i) => i.rps);

console.log(`\n${fromRps.length} de ${year.invoices.length} notas vieram de RPS`);
const { rps } = fromRps.at(-1) ?? {};
if (rps) {
  const byRps = await nfse.findByRps(rps);
  console.log(`  RPS ${rps.number}/${rps.series} → NFS-e ${byRps?.number}`);
}

// 5. Paginação automática ---------------------------------------------------
// O serviço devolve no máximo 50 por página; `paginate` percorre até o fim.
let total = 0;
for await (const page of paginate((n) =>
  nfse.queryProvidedServices({
    issuePeriod: { from: "2026-01-01", to: "2026-12-31" },
    page: n,
  }),
)) {
  total += page.invoices.length;
}
console.log(`\n2026 inteiro: ${total} nota(s)`);
