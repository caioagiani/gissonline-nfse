/**
 * Emitir para várias empresas — o formato de uma aplicação.
 *
 *   node --env-file=.env examples/06-issuing-for-many.mjs
 *
 * Roda com DRY_RUN ligado: monta, assina e valida cada nota sem enviar. Para
 * emitir de verdade, troque para `false` — e leia antes o trecho sobre
 * numeração, que é o que separa emitir de emitir duas vezes.
 */
import { readFileSync } from "node:fs";
import { GissClient, buildRps, loadCertificate, DEFAULT_PROFILE } from "gissonline-nfse";

const DRY_RUN = true;

// ---------------------------------------------------------------------------
// 1. As empresas. Numa aplicação isto é uma tabela, e o `.pfx` vem cifrado da
//    coluna dele, decifrado aqui em memória — nunca escrito em disco.
// ---------------------------------------------------------------------------
const companies = [
  {
    id: "acme",
    city: "suzano",
    cnpj: process.env.GISS_CNPJ,
    municipalRegistration: process.env.GISS_ISC_MUNICIPAL,
    pfx: readFileSync(process.env.CERT_PATH),
    pfxPassword: process.env.CERT_PASSWORD,
    rate: 3.07,
  },
  // outra empresa entraria aqui, com sua cidade e seu certificado
];

// ---------------------------------------------------------------------------
// 2. A numeração do RPS é sua, e precisa ser estável entre tentativas.
//
//    Este contador em memória serve ao exemplo e a nada mais. Numa aplicação
//    de verdade o número sai de uma sequência transacional — `SELECT … FOR
//    UPDATE`, uma sequence do Postgres, o que for — reservado ANTES do envio.
//    Gerar o número na hora do envio (um timestamp, um random) faz a repetição
//    virar um número novo, e um número novo vira uma segunda nota.
// ---------------------------------------------------------------------------
const sequences = new Map();
function reserveRpsNumber(companyId) {
  const next = (sequences.get(companyId) ?? 90000) + 1;
  sequences.set(companyId, next);
  return String(next);
}

// ---------------------------------------------------------------------------
// 3. As notas a emitir, cada uma já com sua empresa.
// ---------------------------------------------------------------------------
const queue = [
  { company: "acme", amount: 1500, description: "Mensalidade de julho", taker: {
    cnpj: "60977243000106", legalName: "EXEMPLO LTDA",
    address: { street: "Avenida Paulista", number: "1000", district: "Bela Vista",
               cityCode: "3550308", state: "SP", zipCode: "01310100" },
  } },
  { company: "acme", amount: 890.5, description: "Serviço avulso", taker: {
    cnpj: "60977243000106", legalName: "EXEMPLO LTDA",
    address: { street: "Avenida Paulista", number: "1000", district: "Bela Vista",
               cityCode: "3550308", state: "SP", zipCode: "01310100" },
  } },
];

// ---------------------------------------------------------------------------
// 4. O laço. O certificado é aberto uma vez por empresa e reaproveitado em
//    todas as notas dela: abrir o PKCS#12 custa ~16 ms, e num lote isso soma.
//    Fora do lote, prefira descartar a guardar chaves privadas vivas.
// ---------------------------------------------------------------------------
for (const company of companies) {
  const certificate = loadCertificate(company.pfx, company.pfxPassword);
  const giss = new GissClient({
    city: company.city,
    cnpj: company.cnpj,
    municipalRegistration: company.municipalRegistration,
    certificate,
  });

  console.log(`\n${company.id} — ${giss.config.host}`);

  for (const item of queue.filter((i) => i.company === company.id)) {
    const rpsNumber = reserveRpsNumber(company.id); // reservado antes do envio
    const rps = buildRps(
      { ...DEFAULT_PROFILE, rate: company.rate },
      {
        taker: item.taker,
        rpsNumber,
        serviceAmount: item.amount,
        description: item.description,
      },
    );

    if (DRY_RUN) {
      const xml = giss.nfse.previewIssueNfse(rps);
      console.log(
        `  RPS ${rpsNumber}  R$ ${item.amount.toFixed(2)}  ` +
          `${(xml.match(/<Signature/g) ?? []).length} assinaturas  ${xml.length} bytes  (não enviado)`,
      );
      continue;
    }

    // `issueRps` consulta pelo RPS antes de enviar e de novo depois de esperar:
    // se este número já virou nota, ela é devolvida em vez de uma segunda.
    const outcome = await giss.nfse.issueRps(rps);
    switch (outcome.status) {
      case "issued":
        console.log(`  RPS ${rpsNumber} → NFS-e ${outcome.invoice.number}`);
        break;
      case "already-issued":
        console.log(`  RPS ${rpsNumber} → já era a NFS-e ${outcome.invoice.number}`);
        break;
      case "pending":
        // O lote foi aceito e ainda processa. Guarde o protocolo e repita
        // depois com o MESMO número de RPS — é seguro justamente por isso.
        console.log(`  RPS ${rpsNumber} → processando, protocolo ${outcome.protocol}`);
        break;
      case "rejected":
        console.log(`  RPS ${rpsNumber} → recusado: ${outcome.warnings.map((w) => w.code).join(", ")}`);
        break;
    }
  }
}

console.log(`\n${DRY_RUN ? "DRY_RUN: nada foi enviado." : "Concluído."}`);
