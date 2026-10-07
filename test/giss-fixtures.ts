import type { SoapCallOptions, SoapOperation, SoapResponse } from "../src/providers/giss/soap-client.ts";
import type { ServiceMessage } from "../src/domain/errors.ts";

/**
 * Respostas do GissOnline com o formato das reais (ABRASF 2.04), mas com dados
 * fictícios. Os exemplos oficiais em docs/exemplos só têm valores de
 * preenchimento ("p1:RazaoSocial"), que não servem para conferir a leitura.
 */
const NS = 'xmlns="http://www.giss.com.br/tipos-v2_04.xsd"';

export interface InvoiceFixture {
  number: string;
  id?: string;
  rps?: { number: string; series: string; type?: string };
  takerCnpj?: string;
  takerName?: string;
  amount?: string;
}

export function compNfse(invoice: InvoiceFixture): string {
  const rps = invoice.rps
    ? `<Rps><IdentificacaoRps><Numero>${invoice.rps.number}</Numero><Serie>${invoice.rps.series}</Serie><Tipo>${invoice.rps.type ?? "1"}</Tipo></IdentificacaoRps></Rps>`
    : "";
  return (
    `<CompNfse><Nfse versao="2.00"><InfNfse Id="${invoice.id ?? `9${invoice.number}`}">` +
    `<Numero>${invoice.number}</Numero><CodigoVerificacao>ABC${invoice.number}</CodigoVerificacao>` +
    `<DataEmissao>2026-10-06T10:00:00.000-03:00</DataEmissao>` +
    `<ValoresNfse><BaseCalculo>${invoice.amount ?? "1500.00"}</BaseCalculo><Aliquota>3.07</Aliquota><ValorIss>46.05</ValorIss><ValorLiquidoNfse>${invoice.amount ?? "1500.00"}</ValorLiquidoNfse></ValoresNfse>` +
    `<PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>37969249000110</Cnpj></CpfCnpj><InscricaoMunicipal>53624</InscricaoMunicipal></IdentificacaoPrestador><RazaoSocial>EMPRESA TESTE LTDA</RazaoSocial></PrestadorServico>` +
    `<DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico>${rps}<Competencia>2026-10-01</Competencia>` +
    `<Servico><Valores><ValorServicos>${invoice.amount ?? "1500.00"}</ValorServicos></Valores><Discriminacao>Desenvolvimento</Discriminacao></Servico>` +
    `<TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>${invoice.takerCnpj ?? "52884617000110"}</Cnpj></CpfCnpj></IdentificacaoTomador>` +
    `<RazaoSocial>${invoice.takerName ?? "CLIENTE TESTE LTDA"}</RazaoSocial>` +
    `<Endereco><Endereco>Rua das Flores</Endereco><Numero>100</Numero><Bairro>Centro</Bairro><CodigoMunicipio>3552502</CodigoMunicipio><Uf>SP</Uf><Cep>08675000</Cep></Endereco>` +
    `<Contato><Email>fin@cliente.com.br</Email></Contato></TomadorServico>` +
    `</InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico></InfNfse></Nfse></CompNfse>`
  );
}

const messages = (tag: string, list: ServiceMessage[]) =>
  list.length === 0
    ? ""
    : `<${tag === "MensagemRetorno" ? "ListaMensagemRetorno" : "ListaMensagemAlertaRetorno"}>` +
      list
        .map(
          (m) =>
            `<${tag}><Codigo>${m.code}</Codigo><Mensagem>${m.message}</Mensagem>${m.correction ? `<Correcao>${m.correction}</Correcao>` : ""}</${tag}>`,
        )
        .join("") +
      `</${tag === "MensagemRetorno" ? "ListaMensagemRetorno" : "ListaMensagemAlertaRetorno"}>`;

export const responses = {
  errors: (root: string, list: ServiceMessage[]) =>
    `<${root} ${NS}>${messages("MensagemRetorno", list)}</${root}>`,

  protocol: (protocol: string, batchNumber = "1") =>
    `<EnviarLoteRpsResposta ${NS}><NumeroLote>${batchNumber}</NumeroLote><DataRecebimento>2026-10-06T10:00:00</DataRecebimento><Protocolo>${protocol}</Protocolo></EnviarLoteRpsResposta>`,

  batch: (status: string, invoices: InvoiceFixture[] = [], warnings: ServiceMessage[] = []) =>
    `<ConsultarLoteRpsResposta ${NS}><Situacao>${status}</Situacao>` +
    (invoices.length ? `<ListaNfse>${invoices.map(compNfse).join("")}</ListaNfse>` : "") +
    messages("MensagemAlertaRetorno", warnings) +
    `</ConsultarLoteRpsResposta>`,

  query: (root: string, invoices: InvoiceFixture[], page?: string) =>
    `<${root} ${NS}><ListaNfse>${invoices.map(compNfse).join("")}${page ? `<Pagina>${page}</Pagina>` : ""}</ListaNfse></${root}>`,

  byRps: (invoice: InvoiceFixture) =>
    `<ConsultarNfseRpsResposta ${NS}>${compNfse(invoice)}</ConsultarNfseRpsResposta>`,

  cancellation: (number: string) =>
    `<CancelarNfseResposta ${NS}><RetCancelamento><NfseCancelamento><Confirmacao><Pedido><InfPedidoCancelamento Id="canc${number}"><IdentificacaoNfse><Numero>${number}</Numero></IdentificacaoNfse></InfPedidoCancelamento></Pedido><DataHora>2026-10-06T11:00:00</DataHora></Confirmacao></NfseCancelamento></RetCancelamento></CancelarNfseResposta>`,
};

export interface SoapCall {
  operation: SoapOperation;
  xml: string;
  options: SoapCallOptions;
}

type SoapRoute = (call: SoapCall, nth: number) => string;

/**
 * Transporte SOAP falso: cada operação responde com o XML da rota (ou lança).
 * `nth` conta as chamadas daquela operação, para roteiros com várias etapas.
 */
export function fakeSoap(routes: Partial<Record<SoapOperation, SoapRoute>>) {
  const calls: SoapCall[] = [];
  const counts = new Map<SoapOperation, number>();
  const transport = async (
    operation: SoapOperation,
    xml: string,
    options: SoapCallOptions,
  ): Promise<SoapResponse> => {
    const call = { operation, xml, options };
    calls.push(call);
    const nth = (counts.get(operation) ?? 0) + 1;
    counts.set(operation, nth);
    const route = routes[operation];
    if (!route) throw new Error(`Operação não prevista no teste: ${operation}`);
    return { status: 200, envelope: "", xml: route(call, nth) };
  };
  return { transport, calls, of: (op: SoapOperation) => calls.filter((c) => c.operation === op) };
}
