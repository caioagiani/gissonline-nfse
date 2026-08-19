/**
 * Cadastro de clientes e consultas auxiliares.
 *
 *   node --env-file=.env examples/05-directory.mjs
 *
 * Só lê. `portal.create`, `portal.update` e `portal.remove` existem, mas não
 * são chamados aqui — alteram o cadastro real da empresa.
 */
import { readFileSync } from "node:fs";
import {
  GissClient,
  PortalService,
  loadPortalCredentials,
  lookupZip,
  lookupCompany,
} from "gissonline-nfse";

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

// Só o `config` é usado aqui: o cadastro vive na API REST, não no Web Service.
const { config } = new GissClient(company);

// 1. O diretório do portal --------------------------------------------------
// O Web Service não tem cadastro: sob o ABRASF os dados do tomador viajam
// dentro de cada nota. O diretório que aparece no portal é uma API REST
// separada, com login de CPF/senha.
const portal = await PortalService.authenticate(loadPortalCredentials(config));
console.log(`empresa: ${portal.session.legalName}`);

const customers = await portal.list(1); // 1 = cliente, 2 = fornecedor
console.log(`\n${customers.length} cliente(s) cadastrado(s):`);
for (const party of customers.slice(0, 5)) {
  console.log(`  ${party.documento.padEnd(14)} ${party.razaoSocial}`);
}

// 2. Buscar um cadastro específico ------------------------------------------
const found = await portal.findByTaxId("60977243000106", 1);
console.log(`\nbusca por CNPJ: ${found ? found.razaoSocial : "não cadastrado"}`);

// 3. Consultas auxiliares (BrasilAPI) ---------------------------------------
// Nenhum serviço do GissOnline resolve CNPJ ou CEP. Estes helpers são
// conveniência para preencher um cadastro — nunca fonte da verdade.
const zip = await lookupZip("01310-100");
console.log(`\nCEP 01310-100: ${zip.street}, ${zip.district}`);
console.log(`  ${zip.city}/${zip.state}`);

const cnpjData = await lookupCompany("60977243000106");
const { city, state, cityCode, status } = cnpjData;
console.log(`CNPJ 60.977.243/0001-06: ${cnpjData.legalName}`);
console.log(`  ${city}/${state}  IBGE ${cityCode}  ${status}`);
