import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GissError, ValidationError } from "../src/domain/errors.ts";
import type { PurchasedService } from "../src/domain/types.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import * as taken from "../src/providers/giss/messages/taken-services.ts";
import { NfscService } from "../src/providers/giss/nfsc-service.ts";
import { SCHEMA_DIRECTORIES, validateAgainstSchema } from "../src/validation/schema-validator.ts";
import { fakeSoap, responses } from "./giss-fixtures.ts";
import { PROVIDER_CNPJ, SUZANO, testCertificate } from "./helpers.ts";

const taker = { cnpj: PROVIDER_CNPJ, municipalRegistration: "53624" };

const purchase = (number = 10): PurchasedService => ({
  declarationType: 2,
  identification: { number, declaredNumber: 900, series: "A", declaredSeries: "1", type: 1 },
  issueDate: "2026-10-01",
  competenceDate: "2026-10-01",
  supplier: {
    cnpj: "52884617000110",
    municipalRegistration: "777",
    legalName: "Fornecedor & Cia Ltda",
    address: {
      street: "Av. Brasil",
      number: "200",
      district: "Centro",
      cityCode: "3550308",
      state: "SP",
      zipCode: "01000000",
    },
    contact: { email: "nf@fornecedor.com.br" },
    simplesNacionalOptant: 2,
  },
  service: {
    amounts: { services: 800, rate: 2 },
    issWithheld: false,
    withholdingResponsible: 1,
    serviceListItem: "01.07",
    description: "Suporte técnico",
    cityCode: "3550308",
    issTaxability: 1,
    incidenceCityCode: "3550308",
    purpose: 0,
  },
});

function service(routes: Parameters<typeof fakeSoap>[0]) {
  const soap = fakeSoap(routes);
  const certificate = testCertificate();
  const nfsc = new NfscService({
    host: "https://ws-teste.giss.com.br",
    certificate,
    signer: createXmlSigner(certificate),
    taker,
    cityCode: SUZANO,
    transport: soap.transport,
  });
  return { nfsc, ...soap };
}

const protocol = (p: string) =>
  `<EnviarLoteNotaServicoCompradoResposta xmlns="x"><Protocolo>${p}</Protocolo></EnviarLoteNotaServicoCompradoResposta>`;

describe("NfscService — serviços tomados", () => {
  it("declara uma nota: serviço nfsc, sem cabeçalho, raiz assinada", async () => {
    const { nfsc, calls } = service({ EmitirNotaServicoComprado: () => protocol("T-1") });
    const result = await nfsc.issuePurchasedService(purchase());
    assert.equal(result.protocol, "T-1");
    const [call] = calls;
    assert.equal(call!.options.service, "nfsc");
    assert.equal(call!.options.header, undefined);
    assert.match(call!.xml, /<Reference URI="">/);
    assert.match(call!.xml, /<DeclaracaoServicoComprado xmlns="">/);
  });

  it("lote vazio e acima de 50 são recusados sem chamar o serviço", async () => {
    const { nfsc, calls } = service({});
    await assert.rejects(nfsc.sendPurchasedServiceBatch({ batchNumber: 1, invoices: [] }), ValidationError);
    const many = Array.from({ length: 51 }, (_, i) => purchase(i + 1));
    await assert.rejects(nfsc.sendPurchasedServiceBatch({ batchNumber: 1, invoices: many }), /limite é 50/);
    assert.equal(calls.length, 0);
  });

  it("fornecedor só com e-mail sai sem Contato (o XSD exige Telefone)", () => {
    const onlyEmail = taken.issuePurchasedServiceRequest(purchase(), taker);
    assert.doesNotMatch(onlyEmail, /Contato/);
    const withPhone = purchase();
    withPhone.supplier.contact = { phone: "1144445555", email: "nf@fornecedor.com.br" };
    assert.match(
      taken.issuePurchasedServiceRequest(withPhone, taker),
      /<tipos:Contato><tipos:Telefone>1144445555<\/tipos:Telefone><tipos:Email>/,
    );
  });

  it("lote conta as notas no atributo", async () => {
    const { nfsc, of } = service({ EnviarLoteNotaServicoComprado: () => protocol("T-2") });
    await nfsc.sendPurchasedServiceBatch({ batchNumber: 3, invoices: [purchase(1), purchase(2)] });
    assert.match(of("EnviarLoteNotaServicoComprado")[0]!.xml, /QuantidadeNotaServicoComprado="2"/);
  });

  it("consulta por número exige número e série declarados (o serviço dá HTTP 400 sem eles)", async () => {
    const { nfsc, calls } = service({});
    await assert.rejects(
      nfsc.queryPurchasedByNumber({
        competencePeriod: { from: "2026-10-01" },
        issuePeriod: { from: "2026-10-01" },
        declaredNumber: "",
        declaredSeries: "1",
      }),
      ValidationError,
    );
    assert.equal(calls.length, 0);
  });

  it("cancelamento usa o município e o tomador configurados", async () => {
    const { nfsc, of } = service({
      CancelarNotaServicoComprado: () =>
        `<CancelarNotaServicoCompradoResposta xmlns="x"><Numero>10</Numero><DataHora>2026-10-06T12:00:00</DataHora></CancelarNotaServicoCompradoResposta>`,
    });
    const result = await nfsc.cancelPurchasedService({ verificationCode: "XYZ", cancellationCode: 1 });
    assert.equal(result.cancelledAt, "2026-10-06T12:00:00");
    const xml = of("CancelarNotaServicoComprado")[0]!.xml;
    assert.match(xml, new RegExp(`<tipos:CodigoMunicipio>${SUZANO}</tipos:CodigoMunicipio>`));
    assert.match(xml, new RegExp(`<tipos:Cnpj>${PROVIDER_CNPJ}</tipos:Cnpj>`));
  });

  it("situação do protocolo vem com o rótulo", async () => {
    const { nfsc } = service({
      ConsultarServicoCompradoPorProtocolo: () =>
        `<R xmlns="x"><Situacao>4</Situacao><Protocolo>T-3</Protocolo></R>`,
    });
    const result = await nfsc.queryPurchasedByProtocol("T-3");
    assert.equal(result.statusLabel, "Processado com sucesso");
  });

  it("mensagem de retorno vira GissError", async () => {
    const { nfsc } = service({
      ConsultarServicoCompradoPorLote: () =>
        responses.errors("ConsultarServicoCompradoPorLoteResposta", [{ code: "E4", message: "Lote não encontrado" }]),
    });
    await assert.rejects(nfsc.queryPurchasedByBatch("T-9"), GissError);
  });
});

describe("serviços tomados — XML de acordo com os XSD vigentes", () => {
  const cases: Array<[string, string, string]> = [
    ["emitir", taken.issuePurchasedServiceRequest(purchase(), taker), "emitir-nota-servico-comprado-envio-v1_00.xsd"],
    [
      "lote",
      taken.sendPurchasedServiceBatchRequest({ batchNumber: 1, invoices: [purchase(1), purchase(2)] }, taker),
      "enviar-lote-nota-servico-comprado-envio-v1_00.xsd",
    ],
    [
      "cancelar",
      taken.cancelPurchasedServiceRequest({ verificationCode: "XYZ", taker, cityCode: SUZANO, cancellationCode: 1 }),
      "cancelar-nota-servico-comprado-envio-v1_00.xsd",
    ],
    [
      "consultar por número",
      taken.queryPurchasedByNumberRequest({
        taker,
        declaredNumber: 900,
        declaredSeries: "1",
        competencePeriod: { from: "2026-10-01", to: "2026-10-31" },
        issuePeriod: { from: "2026-10-01", to: "2026-10-31" },
      }),
      "consultar-nota-servico-comprado-envio-v1_00.xsd",
    ],
    ["consultar lote", taken.queryPurchasedByBatchRequest({ taker, protocol: "1" }), "consultar-lote-nota-servico-comprado-envio-v1_00.xsd"],
    [
      "consultar protocolo",
      taken.queryPurchasedByProtocolRequest({ taker, protocol: "1" }),
      "consultar-protocolo-nota-servico-comprado-envio-v1_00.xsd",
    ],
  ];

  for (const [name, xml, schema] of cases) {
    it(name, (t) => {
      const result = validateAgainstSchema(xml, schema, SCHEMA_DIRECTORIES.gissTaken);
      if (result === null) return t.skip("xmllint não instalado");
      assert.deepEqual(result.errors, []);
    });
  }
});
