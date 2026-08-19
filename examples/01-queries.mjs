/**
 * Consultas — o caminho mais curto para ver o cliente funcionando.
 *
 *   node --env-file=.env examples/01-queries.mjs
 *
 * Só lê. Nada aqui emite, cancela ou altera nota.
 */
import { GissClient } from "gissonline-nfse";

const giss = new GissClient();

// 1. Por período de emissão -------------------------------------------------
const july = await giss.nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});
console.log(`julho: ${july.invoices.length} nota(s)`);
for (const invoice of july.invoices) {
  console.log(
    `  ${invoice.number}  ${invoice.issueDate?.slice(0, 10)}  ` +
      `R$ ${invoice.serviceAmount}  ${invoice.taker?.legalName ?? ""}`,
  );
}

// 2. Uma nota específica ----------------------------------------------------
const [invoice] = (await giss.nfse.queryProvidedServices({ nfseNumber: "573" }))
  .invoices;
if (invoice) {
  console.log(`\nnota ${invoice.number}`);
  console.log(`  verificação: ${invoice.verificationCode}`);
  console.log(`  competência: ${invoice.competenceDate?.slice(0, 10)}`);
  console.log(`  ISS:         R$ ${invoice.issAmount}`);
  console.log(`  id interno:  ${invoice.internalId}   ← usado para baixar o PDF`);
}

// 3. Por faixa de numeração -------------------------------------------------
const range = await giss.nfse.queryNfseRange({
  firstNumber: "566",
  lastNumber: "573",
});
console.log(`\nfaixa 566–573: ${range.invoices.length} nota(s)`);

// 4. Pelo RPS que originou a nota -------------------------------------------
// A resposta da consulta traz o RPS em `raw.IdentificacaoRps`.
const byRps = await giss.nfse.findByRps({ number: "71677", series: "A", type: 1 });
console.log(`\nRPS 71677/A → ${byRps ? `NFS-e ${byRps.number}` : "ainda não virou nota"}`);

// 5. Paginação automática ---------------------------------------------------
// O serviço devolve no máximo 50 por página; `paginate` percorre até o fim.
let total = 0;
for await (const page of giss.paginate((page) =>
  giss.nfse.queryProvidedServices({
    issuePeriod: { from: "2026-01-01", to: "2026-12-31" },
    page,
  }),
)) {
  total += page.invoices.length;
}
console.log(`\n2026 inteiro: ${total} nota(s)`);
