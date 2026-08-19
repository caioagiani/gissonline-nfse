/**
 * Emissão — montagem, validação e idempotência.
 *
 *   node --env-file=.env examples/03-issuing.mjs
 *
 * **Nada é emitido aqui.** O RPS é montado, assinado e validado contra o XSD,
 * mas só `issueRps` envia — e a única chamada a ele neste arquivo usa um RPS
 * que já virou nota, justamente para mostrar que repetir não emite de novo.
 */
import { readFileSync } from "node:fs";
import { GissClient, buildRps, DEFAULT_PROFILE } from "gissonline-nfse";

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

const giss = new GissClient(company);

// O tomador é um objeto puro: pode vir do seu banco, do cadastro local ou
// do portal. O pacote não impõe onde os dados moram.
const taker = {
  cnpj: "60977243000106",
  legalName: "EXEMPLO LTDA",
  address: {
    street: "Avenida Paulista",
    number: "1000",
    district: "Bela Vista",
    cityCode: "3550308",
    state: "SP",
    zipCode: "01310100",
  },
};

// A alíquota não tem padrão: ela é de cada contribuinte, e um valor chutado
// emitiria imposto errado. Sem ela, com o ISS exigível, `buildRps` recusa.
const rps = buildRps(
  { ...DEFAULT_PROFILE, rate: 3.07 },
  {
    taker,
    rpsNumber: "90001",
    serviceAmount: 1500,
    description: "Desenvolvimento de software",
  },
);

// `previewIssueNfse` assina e devolve o XML sem enviar nada.
const xml = giss.nfse.previewIssueNfse(rps);
console.log("RPS montado e assinado");
console.log(`  assinaturas: ${(xml.match(/<Signature/g) ?? []).length}`);
console.log(`  alíquota no XML: ${xml.match(/Aliquota>([^<]*)</)?.[1]}  ← 3,07% vai como fração`);
console.log(`  bytes: ${xml.length}`);

// O que acontece sem alíquota, com o ISS exigível
try {
  buildRps(DEFAULT_PROFILE, { taker, rpsNumber: "90002", serviceAmount: 10, description: "x" });
} catch (error) {
  console.log(`\nsem alíquota → ${error.message}`);
}

// Idempotência: o RPS 71677/A já virou a nota 573. Pedir de novo devolve a
// nota existente em vez de emitir uma segunda.
const outcome = await giss.nfse.issueRps(
  buildRps({ ...DEFAULT_PROFILE, rate: 3.07 }, {
    taker,
    rpsNumber: "71677",
    serviceAmount: 908,
    description: "mesma intenção de emissão",
  }),
);
console.log(`\nRPS 71677 novamente → ${outcome.status}`);
console.log(`  nota ${outcome.invoice?.number} (${outcome.invoice?.verificationCode}) — nada foi enviado`);

// Para emitir de verdade seria o mesmo `issueRps` com um número novo,
// reservado por você antes do envio:
//
//   const outcome = await giss.nfse.issueRps(rps);
//   if (outcome.status === "issued") console.log(outcome.invoice.number);
