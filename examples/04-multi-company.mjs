/**
 * Várias empresas e vários municípios no mesmo processo.
 *
 *   node --env-file=.env examples/04-multi-company.mjs
 *
 * É o cenário de quem consome o pacote a partir de uma aplicação: cada empresa
 * tem seu certificado e sua cidade, e nada vem de variável de ambiente.
 */
import { readFileSync } from "node:fs";
import {
  GissClient,
  GissError,
  MUNICIPALITIES,
  findMunicipality,
  loadCertificate,
} from "gissonline-nfse";

// 1. Os municípios que publicam o Web Service ------------------------------
console.log(`${MUNICIPALITIES.length} municípios conhecidos`);
const sp = MUNICIPALITIES.filter((m) => m.state === "SP");
console.log(`  SP: ${sp.map((m) => m.name).slice(0, 6).join(", ")}…`);
console.log(`  guarulhos → IBGE ${findMunicipality("guarulhos")?.cityCode}`);

// 2. O certificado a partir da memória --------------------------------------
// Numa aplicação o .pfx vem cifrado do banco e é decifrado aqui — nunca
// escrito em disco. `loadCertificate` aceita o Buffer direto.
const pfx = readFileSync(process.env.CERT_PATH);
const certificate = loadCertificate(pfx, process.env.CERT_PASSWORD);
console.log(`\ncertificado: ${certificate.subject}`);
console.log(`  válido até ${certificate.validTo.toISOString().slice(0, 10)}`);

// Passar o `Certificate` já carregado evita reabrir o PKCS#12 a cada cliente,
// que é a parte cara. Vale dentro de um lote; guardar muitas chaves privadas
// vivas por muito tempo troca 4% de latência por risco desproporcional.
const tenant = {
  environment: "producao",
  cnpj: process.env.GISS_CNPJ,
  municipalRegistration: process.env.GISS_ISC_MUNICIPAL,
  certificate,
  // sem `certificatePassword`: com o certificado já carregado ele não é
  // necessário, porque a senha só existia para abrir o arquivo
};

// 3. A mesma empresa contra cidades diferentes ------------------------------
// O código IBGE vem da cidade; passar `cityCode` explicitamente ainda vence.
for (const city of ["suzano", "guarulhos", "santos"]) {
  const { nfse, config } = new GissClient({ ...tenant, city });
  process.stdout.write(`\n${city} (${config.cityCode}) `);
  try {
    const { invoices } = await nfse.queryProvidedServices({
      issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
    });
    console.log(`→ ${invoices.length} nota(s)`);
  } catch (error) {
    const code =
      error instanceof GissError ? error.messages[0]?.message : error.message;
    console.log(`→ ${code}`);
    if (code === "E361") {
      console.log("   a empresa não tem inscrição municipal aqui — o resto do");
      console.log("   caminho (mTLS, envelope, assinatura, schema) passou.");
    }
  }
}
