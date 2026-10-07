import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBatchResult,
  parseCancellationResult,
  parseErrors,
  parseProtocolResult,
  parseQueryResult,
} from "../src/providers/giss/messages/parser.ts";
import { compNfse, responses } from "./giss-fixtures.ts";

describe("leitura das respostas do GissOnline", () => {
  it("normaliza a nota: número, id interno, RPS, valores e partes", () => {
    const xml = responses.query("ConsultarNfseServicoPrestadoResposta", [
      { number: "580", id: "123456", rps: { number: "42", series: "A", type: "1" }, amount: "1500.00" },
    ]);
    const [invoice] = parseQueryResult(xml).invoices;
    assert.equal(invoice!.number, "580");
    assert.equal(invoice!.internalId, "123456");
    assert.deepEqual(invoice!.rps, { number: "42", series: "A", type: 1 });
    assert.equal(invoice!.verificationCode, "ABC580");
    assert.equal(invoice!.competenceDate, "2026-10-01");
    assert.equal(invoice!.serviceAmount, "1500.00");
    assert.equal(invoice!.netAmount, "1500.00");
    assert.equal(invoice!.issAmount, "46.05");
    assert.equal(invoice!.description, "Desenvolvimento");
    assert.deepEqual(invoice!.provider, {
      taxId: "37969249000110",
      municipalRegistration: "53624",
      legalName: "EMPRESA TESTE LTDA",
      email: undefined,
      cityCode: undefined,
    });
    assert.equal(invoice!.taker?.taxId, "52884617000110");
    assert.equal(invoice!.taker?.email, "fin@cliente.com.br");
    assert.equal(invoice!.taker?.cityCode, "3552502");
  });

  it("nota lançada no portal não tem RPS", () => {
    const [invoice] = parseQueryResult(responses.query("R", [{ number: "1" }])).invoices;
    assert.equal(invoice!.rps, undefined);
  });

  it("zeros à esquerda e números grandes ficam como texto", () => {
    const [invoice] = parseQueryResult(
      responses.query("R", [{ number: "000123", takerCnpj: "01234567000189" }]),
    ).invoices;
    assert.equal(invoice!.number, "000123");
    assert.equal(invoice!.taker?.taxId, "01234567000189");
  });

  it("lista vazia, uma nota e várias", () => {
    assert.deepEqual(parseQueryResult(responses.query("R", [])).invoices, []);
    assert.equal(parseQueryResult(`<R xmlns="x">${compNfse({ number: "1" })}</R>`).invoices.length, 1);
    assert.equal(parseQueryResult(responses.query("R", [{ number: "1" }, { number: "2" }, { number: "3" }])).invoices.length, 3);
  });

  it("situação do lote com rótulo; desconhecida não quebra", () => {
    const done = parseBatchResult(responses.batch("4", [{ number: "9" }]));
    assert.equal(done.statusLabel, "Processado com sucesso");
    assert.equal(done.invoices[0]!.number, "9");
    assert.equal(parseBatchResult(responses.batch("7")).statusLabel, "Desconhecida");
  });

  it("protocolo do lote", () => {
    assert.deepEqual(
      { ...parseProtocolResult(responses.protocol("P-1", "5")), xml: undefined },
      { batchNumber: "5", receivedAt: "2026-10-06T10:00:00", protocol: "P-1", warnings: [], xml: undefined },
    );
  });

  it("cancelamento devolve número e data/hora", () => {
    const result = parseCancellationResult(responses.cancellation("580"));
    assert.equal(result.nfseNumber, "580");
    assert.equal(result.cancelledAt, "2026-10-06T11:00:00");
  });

  it("erros e alertas são separados", () => {
    const xml = responses.batch("3", [], [{ code: "A1", message: "alerta" }]);
    assert.deepEqual(parseErrors(xml), []);
    assert.deepEqual(parseBatchResult(xml).warnings, [{ code: "A1", message: "alerta", correction: undefined }]);

    const errors = parseErrors(
      responses.errors("R", [
        { code: "E1", message: "um" },
        { code: "E2", message: "dois", correction: "faça X" },
      ]),
    );
    assert.deepEqual(errors, [
      { code: "E1", message: "um", correction: undefined },
      { code: "E2", message: "dois", correction: "faça X" },
    ]);
  });

  it("mensagem com prefixo de namespace também é lida", () => {
    const xml =
      `<ns2:R xmlns:ns2="x" xmlns:t="y"><t:ListaMensagemRetorno><t:MensagemRetorno>` +
      `<t:Codigo>E370</t:Codigo><t:Mensagem>Alíquota</t:Mensagem></t:MensagemRetorno></t:ListaMensagemRetorno></ns2:R>`;
    assert.deepEqual(parseErrors(xml), [{ code: "E370", message: "Alíquota", correction: undefined }]);
  });
});

it("GISS: referências numéricas no texto são decodificadas", () => {
  const xml = responses.query("R", [{ number: "1", takerName: "Caf&#233; &#xE7;" }]);
  assert.equal(parseQueryResult(xml).invoices[0]!.taker?.legalName, "Café ç");
});
