import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignedXml } from "xml-crypto";
import { GissError, TransportError, ValidationError } from "../src/domain/errors.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { NfseService } from "../src/providers/giss/nfse-service.ts";
import type { Rps } from "../src/domain/types.ts";
import { fakeSoap, responses } from "./giss-fixtures.ts";
import { PROVIDER_CNPJ, SUZANO, sampleRps, testCertificate } from "./helpers.ts";

const provider = { cnpj: PROVIDER_CNPJ, municipalRegistration: "53624" };
const NOT_FOUND = responses.errors("ConsultarNfseRpsResposta", [
  { code: "E92", message: "RPS não encontrado" },
]);
const rpsNumber = { number: "42", series: "A", type: 1 as const };
const withRps = (): Rps => ({ ...sampleRps(), identification: rpsNumber });
const fast = { attempts: 3, intervalMs: 0 };

function service(routes: Parameters<typeof fakeSoap>[0]) {
  const soap = fakeSoap(routes);
  const certificate = testCertificate();
  const nfse = new NfseService({
    host: "https://ws-teste.giss.com.br",
    certificate,
    signer: createXmlSigner(certificate),
    provider,
    cityCode: SUZANO,
    version: "2.04",
    transport: soap.transport,
  });
  return { nfse, ...soap };
}

/** Confere cada `Signature` do documento com a chave do certificado de teste. */
function verifyAll(xml: string): number {
  const signatures = xml.match(/<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*?<\/Signature>/g) ?? [];
  for (const signature of signatures) {
    const verifier = new SignedXml({ publicCert: testCertificate().certificatePem });
    verifier.loadSignature(signature);
    assert.ok(verifier.checkSignature(xml), "assinatura inválida");
  }
  return signatures.length;
}

describe("NfseService.issueRps — emissão idempotente", () => {
  it("sem número de RPS recusa antes de qualquer chamada", async () => {
    const { nfse, calls } = service({});
    await assert.rejects(nfse.issueRps(sampleRps(), fast), ValidationError);
    assert.equal(calls.length, 0);
  });

  it("RPS que já virou nota: devolve a nota e não envia lote", async () => {
    const { nfse, of } = service({
      ConsultarNfsePorRps: () => responses.byRps({ number: "580", rps: { number: "42", series: "A" } }),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "already-issued");
    assert.equal(outcome.invoice?.number, "580");
    assert.equal(of("RecepcionarLoteRps").length, 0);
  });

  it("envia o lote, consulta o protocolo e devolve a nota emitida", async () => {
    const { nfse, calls } = service({
      ConsultarNfsePorRps: () => NOT_FOUND,
      RecepcionarLoteRps: () => responses.protocol("P-1", "42"),
      ConsultarLoteRps: () => responses.batch("4", [{ number: "581", rps: { number: "42", series: "A" } }]),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "issued");
    assert.equal(outcome.invoice?.number, "581");
    assert.equal(outcome.protocol, "P-1");
    assert.deepEqual(
      calls.map((c) => c.operation),
      ["ConsultarNfsePorRps", "RecepcionarLoteRps", "ConsultarLoteRps"],
    );
  });

  it("protocolo ainda não lido: tenta de novo até a nota aparecer", async () => {
    const { nfse, of } = service({
      ConsultarNfsePorRps: () => NOT_FOUND,
      RecepcionarLoteRps: () => responses.protocol("P-2"),
      ConsultarLoteRps: (_, nth) =>
        nth < 3
          ? responses.errors("ConsultarLoteRpsResposta", [{ code: "E4", message: "Lote não processado" }])
          : responses.batch("4", [{ number: "582" }]),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "issued");
    assert.equal(of("ConsultarLoteRps").length, 3);
  });

  it("lote processado com erro: rejected, com os avisos", async () => {
    const { nfse } = service({
      ConsultarNfsePorRps: () => NOT_FOUND,
      RecepcionarLoteRps: () => responses.protocol("P-3"),
      ConsultarLoteRps: () => responses.batch("3", [], [{ code: "E163", message: "Alíquota ausente" }]),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.protocol, "P-3");
    assert.deepEqual(outcome.warnings, [{ code: "E163", message: "Alíquota ausente", correction: undefined }]);
  });

  it("espera esgotada e nada encontrado: pending, com o protocolo para retomar", async () => {
    const { nfse, of } = service({
      ConsultarNfsePorRps: () => NOT_FOUND,
      RecepcionarLoteRps: () => responses.protocol("P-4"),
      ConsultarLoteRps: () => responses.batch("2"),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "pending");
    assert.equal(outcome.protocol, "P-4");
    assert.equal(of("ConsultarLoteRps").length, 3);
    // a palavra final é da consulta por RPS, antes e depois da espera
    assert.equal(of("ConsultarNfsePorRps").length, 2);
  });

  it("espera esgotada, mas a nota saiu depois: issued", async () => {
    const { nfse } = service({
      ConsultarNfsePorRps: (_, nth) => (nth === 1 ? NOT_FOUND : responses.byRps({ number: "583" })),
      RecepcionarLoteRps: () => responses.protocol("P-5"),
      ConsultarLoteRps: () => responses.batch("2"),
    });
    const outcome = await nfse.issueRps(withRps(), fast);
    assert.equal(outcome.status, "issued");
    assert.equal(outcome.invoice?.number, "583");
  });

  it("falha no envio leva o RPS no erro, para repetir com segurança", async () => {
    const { nfse } = service({
      ConsultarNfsePorRps: () => NOT_FOUND,
      RecepcionarLoteRps: () => {
        throw new TransportError("caiu", { outcomeUnknown: true });
      },
    });
    await assert.rejects(nfse.issueRps(withRps(), fast), (error) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.outcomeUnknown, true);
      assert.deepEqual(error.details["rps"], rpsNumber);
      return true;
    });
  });

  it("falha de rede na consulta por RPS não é tratada como 'não existe'", async () => {
    const { nfse, of } = service({
      ConsultarNfsePorRps: () => {
        throw new TransportError("caiu");
      },
    });
    await assert.rejects(nfse.issueRps(withRps(), fast), TransportError);
    assert.equal(of("RecepcionarLoteRps").length, 0);
  });
});

describe("NfseService — assinatura por operação", () => {
  it("lote: uma assinatura por RPS e outra no LoteRps, todas válidas", async () => {
    const { nfse, of } = service({ RecepcionarLoteRps: () => responses.protocol("P") });
    const second: Rps = { ...sampleRps(), identification: { number: "43", series: "A", type: 1 } };
    await nfse.sendRpsBatch({ batchNumber: 7, rps: [withRps(), second] });
    const xml = of("RecepcionarLoteRps")[0]!.xml;
    assert.equal(verifyAll(xml), 3);
    assert.match(xml, /<Reference URI="#lote7">/);
  });

  it("GerarNfse assina o RPS por dentro do elemento Rps", async () => {
    const { nfse, of } = service({ GerarNfse: () => responses.query("GerarNfseResposta", [{ number: "1" }]) });
    await nfse.issueNfse(withRps());
    const xml = of("GerarNfse")[0]!.xml;
    assert.equal(verifyAll(xml), 1);
    assert.match(xml, /<\/tipos:InfDeclaracaoPrestacaoServico><Signature [^>]*>[\s\S]*<\/Signature><\/Rps>/);
  });

  it("cancelamento assina o pedido referenciando seu Id", async () => {
    const { nfse, of } = service({ CancelarNfse: () => responses.cancellation("580") });
    const result = await nfse.cancelNfse({ nfseNumber: 580, cancellationCode: 1 });
    assert.equal(result.nfseNumber, "580");
    assert.equal(result.cancelledAt, "2026-10-06T11:00:00");
    const xml = of("CancelarNfse")[0]!.xml;
    assert.equal(verifyAll(xml), 1);
    assert.match(xml, /<Reference URI="#canc580">/);
  });

  it("substituição assina RPS, pedido e envelope", async () => {
    const { nfse, of } = service({ SubstituirNfse: () => responses.query("SubstituirNfseResposta", [{ number: "590" }]) });
    await nfse.replaceNfse({ nfseNumber: 580, cancellationCode: 1 }, withRps());
    assert.equal(verifyAll(of("SubstituirNfse")[0]!.xml), 3);
  });

  it("ConsultarNfseServicoTomado vai sem assinatura (o XSD não a declara: E160)", async () => {
    const { nfse, of } = service({ ConsultarNfseServicoTomado: () => responses.query("ConsultarNfseServicoTomadoResposta", []) });
    await nfse.queryTakenServices({ nfseNumber: 1 });
    assert.doesNotMatch(of("ConsultarNfseServicoTomado")[0]!.xml, /<Signature/);
  });

  it("consultas assinam o documento inteiro", async () => {
    const { nfse, of } = service({
      ConsultarNfseServicoPrestado: () => responses.query("ConsultarNfseServicoPrestadoResposta", []),
    });
    await nfse.queryProvidedServices({ issuePeriod: { from: "2026-10-01", to: "2026-10-31" } });
    const xml = of("ConsultarNfseServicoPrestado")[0]!.xml;
    assert.match(xml, /<Reference URI="">/);
    assert.equal(verifyAll(xml), 1);
  });

  it("envia o cabeçalho da versão e o host configurado", async () => {
    const { nfse, calls } = service({ ConsultarLoteRps: () => responses.batch("4") });
    await nfse.queryRpsBatch("P");
    assert.equal(calls[0]!.options.host, "https://ws-teste.giss.com.br");
    assert.equal(calls[0]!.options.service, "nfse");
    assert.match(calls[0]!.options.header ?? "", /versao="2\.04"/);
  });
});

describe("NfseService — respostas e erros", () => {
  it("ListaMensagemRetorno vira GissError com código e correção", async () => {
    const { nfse } = service({
      ConsultarNfsePorFaixa: () =>
        responses.errors("ConsultarNfseFaixaResposta", [
          { code: "E160", message: "Fora do schema", correction: "Confira o XML" },
        ]),
    });
    await assert.rejects(nfse.queryNfseRange({ firstNumber: 1, lastNumber: 2 }), (error) => {
      assert.ok(error instanceof GissError);
      assert.equal(error.operation, "ConsultarNfsePorFaixa");
      assert.deepEqual(error.messages, [{ code: "E160", message: "Fora do schema", correction: "Confira o XML" }]);
      return true;
    });
  });

  it("lê várias notas e a página", async () => {
    const { nfse } = service({
      ConsultarNfseServicoPrestado: () =>
        responses.query("ConsultarNfseServicoPrestadoResposta", [{ number: "1" }, { number: "2" }], "2"),
    });
    const result = await nfse.queryProvidedServices({ nfseNumber: 1 });
    assert.deepEqual(result.invoices.map((i) => i.number), ["1", "2"]);
    assert.equal(result.page, "2");
  });

  it("lote vazio e lote acima de 50 são recusados antes do envio", async () => {
    const { nfse, calls } = service({});
    await assert.rejects(nfse.sendRpsBatch({ batchNumber: 1, rps: [] }), ValidationError);
    const many = Array.from({ length: 51 }, () => withRps());
    await assert.rejects(nfse.sendRpsBatch({ batchNumber: 1, rps: many }), /limite é 50/);
    assert.equal(calls.length, 0);
  });

  it("previewIssueNfse assina sem enviar", () => {
    const { nfse, calls } = service({});
    assert.equal(verifyAll(nfse.previewIssueNfse(withRps())), 1);
    assert.equal(calls.length, 0);
  });
});
