import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rps } from "../src/domain/types.ts";
import {
  generateNfseRequest,
  sendRpsBatchRequest,
} from "../src/providers/giss/messages/provided-services.ts";
import { validateAgainstSchema } from "../src/validation/schema-validator.ts";
import { PROVIDER_CNPJ, sampleRps } from "./helpers.ts";

const provider = { cnpj: "11222333000181", municipalRegistration: "123456" };

/** Exportação de serviço para tomador nos EUA — o caso que exige comExt. */
const exportRps = (): Rps => ({
  identification: { number: 1, series: "1", type: 1 },
  issueDate: "2026-09-30",
  competenceDate: "2026-09-30",
  service: {
    amounts: { services: 1554.27, rate: 0 },
    issWithheld: 2,
    serviceListItem: "01.07",
    description: "Software development services",
    // ABRASF: serviço no exterior vai com município 9999999 + país (senão E310)
    cityCode: "9999999",
    countryCode: "0840",
    issTaxability: 4,
    incidenceCityCode: "3518800",
    foreignTrade: {
      serviceMode: "1",
      relationship: "0",
      currency: "220",
      foreignAmount: 300,
      providerSupport: "01",
      takerSupport: "01",
      temporaryGoods: "1",
      shareWithMdic: "0",
    },
  },
  taker: {
    nif: "123456789",
    legalName: "Acme Inc.",
    foreignAddress: {
      countryCode: "0840",
      fullAddress: "100 Congress Ave Suite 200",
      postalCode: "78701",
      city: "Austin",
      region: "TX",
    },
  },
  simplesNacionalOptant: 1,
  taxIncentive: 2,
});

const build = (rps: Rps) =>
  sendRpsBatchRequest({ batchNumber: 1, rps: [rps] }, provider, "2.04");

test("export RPS is valid against the XSD", (t) => {
  const result = validateAgainstSchema(build(exportRps()), "enviar-lote-rps-envio-v2_04.xsd");
  if (result === null) return t.skip("xmllint not installed");
  assert.deepEqual(result.errors, []);
});

test("comExt closes Servico, in the XSD order", () => {
  const xml = build(exportRps());
  assert.match(
    xml,
    /<tipos:MunicipioIncidencia>3518800<\/tipos:MunicipioIncidencia><tipos:comExt><tipos:mdPrestacao>1<\/tipos:mdPrestacao><tipos:vincPrest>0<\/tipos:vincPrest><tipos:tpMoeda>220<\/tipos:tpMoeda><tipos:vServMoeda>300.00<\/tipos:vServMoeda><tipos:mecAFComexP>01<\/tipos:mecAFComexP><tipos:mecAFComexT>01<\/tipos:mecAFComexT><tipos:movTempBens>1<\/tipos:movTempBens><tipos:mdic>0<\/tipos:mdic><\/tipos:comExt><\/tipos:Servico>/,
  );
  assert.match(
    xml,
    /<tipos:RazaoSocial>Acme Inc.<\/tipos:RazaoSocial><tipos:EnderecoExterior><tipos:CodigoPais>0840<\/tipos:CodigoPais>/,
  );
});

test("optional nDI/nRE land between movTempBens and mdic", (t) => {
  const rps = exportRps();
  rps.service.foreignTrade = {
    ...rps.service.foreignTrade!,
    temporaryGoods: "3",
    exportRegistration: "RE1234567890",
  };
  const xml = build(rps);
  assert.match(xml, /<tipos:movTempBens>3<\/tipos:movTempBens><tipos:nRE>RE1234567890<\/tipos:nRE><tipos:mdic>/);
  const result = validateAgainstSchema(xml, "enviar-lote-rps-envio-v2_04.xsd");
  if (result === null) return t.skip("xmllint not installed");
  assert.deepEqual(result.errors, []);
});

test("domestic RPS carries no comExt nor EnderecoExterior", () => {
  const rps = exportRps();
  delete rps.service.foreignTrade;
  delete rps.taker!.foreignAddress;
  const xml = build(rps);
  assert.doesNotMatch(xml, /comExt|EnderecoExterior/);
});

test("address and foreignAddress together are refused", () => {
  const rps = exportRps();
  rps.taker!.address = {
    street: "Rua A",
    number: "1",
    district: "Centro",
    cityCode: "3518800",
    state: "SP",
    zipCode: "07000000",
  };
  assert.throws(() => build(rps), /address ou foreignAddress/);
});

const suzano = { cnpj: PROVIDER_CNPJ, municipalRegistration: "53624" };

test("OutrasRetencoes fica de fora quando zerada: Suzano recusa a tag com E370", () => {
  const xml = generateNfseRequest(sampleRps(), suzano, "2.04");
  assert.doesNotMatch(xml, /OutrasRetencoes/);
  // os vizinhos obrigatórios continuam lá
  assert.match(xml, /ValorCsll>0\.00</);
  assert.match(xml, /ValTotTributos>0\.00</);
});

test("OutrasRetencoes vai quando há valor", () => {
  const xml = generateNfseRequest(sampleRps({ otherWithholdings: 12.5 }), suzano, "2.04");
  assert.match(xml, /OutrasRetencoes>12\.50</);
});

