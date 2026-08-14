import type {
  Amounts,
  PartyIdentification,
  PurchasedService,
  PurchasedServiceBatch,
  PurchasedServiceDetails,
  Supplier,
} from "../domain/types.ts";
import {
  amount,
  element,
  group,
  isoDate,
  requiredGroup,
  xmlDocument,
} from "../infra/xml.ts";

/** Builders das mensagens do serviço `nfsc` (serviços tomados). Schemas v1.00. */

const VERSION = "1_00";
const TYPES_NS = `http://www.giss.com.br/tipos-servicos-comprados-v${VERSION}.xsd`;
const T = "tipos";

function namespaceFor(schema: string): string {
  return `http://www.giss.com.br/${schema}-v${VERSION}.xsd`;
}

const prefixes = { [T]: TYPES_NS };

function taxIdGroup(party: { cnpj?: string; cpf?: string }): string {
  return requiredGroup(`${T}:CpfCnpj`, [
    party.cnpj ? element(`${T}:Cnpj`, party.cnpj) : element(`${T}:Cpf`, party.cpf),
  ]);
}

function partyGroup(tag: string, party: PartyIdentification): string {
  return requiredGroup(tag, [
    taxIdGroup(party),
    element(`${T}:InscricaoMunicipal`, party.municipalRegistration),
  ]);
}

function supplierGroup(supplier: Supplier): string {
  return requiredGroup(`${T}:DadosPrestador`, [
    partyGroup(`${T}:Identificacao`, supplier),
    element(`${T}:NifTomador`, supplier.nif),
    element(`${T}:NomeFantasia`, supplier.tradeName),
    element(`${T}:RazaoSocial`, supplier.legalName),
    supplier.address
      ? requiredGroup(`${T}:Endereco`, [
          element(`${T}:Endereco`, supplier.address.street),
          element(`${T}:Numero`, supplier.address.number),
          element(`${T}:Complemento`, supplier.address.complement),
          element(`${T}:Bairro`, supplier.address.district),
          element(`${T}:CodigoMunicipio`, supplier.address.cityCode),
          element(`${T}:Uf`, supplier.address.state),
          element(`${T}:Cep`, supplier.address.zipCode),
        ])
      : "",
    supplier.contact
      ? group(`${T}:Contato`, [
          element(`${T}:Telefone`, supplier.contact.phone),
          element(`${T}:Email`, supplier.contact.email),
        ])
      : "",
    element(`${T}:RegimeEspecialTributacao`, supplier.specialTaxRegime),
    element(`${T}:OptanteSimplesNacional`, supplier.simplesNacionalOptant),
  ]);
}

function amountsGroup(amounts: Amounts): string {
  return requiredGroup(`${T}:Valores`, [
    element(`${T}:ValorServicos`, amount(amounts.services)),
    element(`${T}:ValorDeducoes`, amount(amounts.deductions)),
    element(`${T}:ValorPis`, amount(amounts.pis)),
    element(`${T}:ValorCofins`, amount(amounts.cofins)),
    element(`${T}:ValorInss`, amount(amounts.inss)),
    element(`${T}:ValorIr`, amount(amounts.incomeTax)),
    element(`${T}:ValorCsll`, amount(amounts.csll)),
    element(`${T}:OutrasRetencoes`, amount(amounts.otherWithholdings)),
    element(`${T}:ValTotTributos`, amount(amounts.totalTaxes)),
    element(`${T}:ValorIss`, amount(amounts.iss)),
    amounts.rate === undefined
      ? ""
      : element(`${T}:Aliquota`, Number(amounts.rate).toFixed(2)),
    element(`${T}:DescontoIncondicionado`, amount(amounts.unconditionalDiscount)),
    element(`${T}:DescontoCondicionado`, amount(amounts.conditionalDiscount)),
  ]);
}

function serviceGroup(service: PurchasedServiceDetails): string {
  const pisCofins = service.amounts.pisCofins;
  const ibs = service.amounts.ibsCbs;
  return requiredGroup(`${T}:DadosServicoComprado`, [
    amountsGroup(service.amounts),
    service.issWithheld === undefined
      ? ""
      : element(`${T}:IssRetido`, String(service.issWithheld)),
    element(`${T}:ResponsavelRetencao`, service.withholdingResponsible),
    element(`${T}:ItemListaServico`, service.serviceListItem),
    element(`${T}:CodigoCnae`, service.cnaeCode),
    element(`${T}:CodigoTributacaoMunicipio`, service.municipalTaxCode),
    element(`${T}:CodigoNbs`, service.nbsCode),
    element(`${T}:Discriminacao`, service.description),
    element(`${T}:CodigoMunicipio`, service.cityCode),
    element(`${T}:CodigoPais`, service.countryCode),
    element(`${T}:ExigibilidadeISS`, service.issTaxability),
    element(`${T}:IdentifNaoExigibilidade`, service.nonTaxabilityId),
    element(`${T}:MunicipioIncidencia`, service.incidenceCityCode),
    pisCofins
      ? requiredGroup(`${T}:piscofins`, [
          element(`${T}:CST`, pisCofins.cst),
          element(`${T}:vBCPisCofins`, amount(pisCofins.taxableAmount)),
          element(`${T}:pAliqPis`, amount(pisCofins.pisRate)),
          element(`${T}:pAliqCofins`, amount(pisCofins.cofinsRate)),
          element(`${T}:vPis`, amount(pisCofins.pisAmount)),
          element(`${T}:vCofins`, amount(pisCofins.cofinsAmount)),
          pisCofins.withholdingType === undefined
            ? ""
            : element(`${T}:tpRetPisCofins`, pisCofins.withholdingType),
        ])
      : "",
    element(`${T}:finNFSe`, service.purpose),
    // O IBSCBS de serviços comprados tem estrutura própria — mais rasa que a de
    // serviços prestados, e com `cindOp` em minúscula.
    ibs
      ? requiredGroup(`${T}:IBSCBS`, [
          element(`${T}:indFinal`, ibs.endConsumer),
          element(`${T}:cindOp`, ibs.operationIndicator),
          element(`${T}:tpOper`, ibs.operationType),
          (ibs.references ?? []).map((ref) => element(`${T}:refNFSe`, ref)).join(""),
          element(`${T}:indDest`, ibs.recipientIndicator),
          requiredGroup(`${T}:gIBSCBS`, [
            element(`${T}:CST`, ibs.cst),
            element(`${T}:cClassTrib`, ibs.taxClassification),
            element(`${T}:cLocalidadeIncid`, ibs.incidenceLocationCode),
            element(`${T}:pRedutor`, amount(ibs.reductionRate)),
            element(`${T}:vBC`, amount(ibs.taxableAmount)),
          ]),
        ])
      : "",
  ]);
}

/** `DeclaracaoServicoComprado` — uma nota de fornecedor. */
export function purchasedServiceDeclaration(
  tag: string,
  invoice: PurchasedService,
  defaultTaker: PartyIdentification,
): string {
  return requiredGroup(tag, [
    element(`${T}:TipoDeclaracaoNota`, invoice.declarationType),
    requiredGroup(`${T}:IdentificacaoDeclaracao`, [
      element(`${T}:Numero`, invoice.identification.number),
      element(`${T}:NumeroDeclarado`, invoice.identification.declaredNumber),
      element(`${T}:Serie`, invoice.identification.series),
      element(`${T}:SerieDeclarada`, invoice.identification.declaredSeries),
      element(`${T}:Tipo`, invoice.identification.type),
    ]),
    element(`${T}:ChaveNotaNacional`, invoice.nationalInvoiceKey),
    element(`${T}:DataEmissao`, isoDate(invoice.issueDate)),
    element(`${T}:Competencia`, isoDate(invoice.competenceDate)),
    partyGroup(`${T}:DadosTomador`, invoice.taker ?? defaultTaker),
    supplierGroup(invoice.supplier),
    serviceGroup(invoice.service),
    invoice.construction
      ? group(`${T}:DadosConstrucaoCivil`, [
          element(`${T}:CodigoObra`, invoice.construction.workCode),
          element(`${T}:Art`, invoice.construction.art),
        ])
      : "",
  ]);
}

export function issuePurchasedServiceRequest(
  invoice: PurchasedService,
  taker: PartyIdentification,
): string {
  // `emitir-nota-servico-comprado-envio` é o único schema do pacote sem
  // elementFormDefault="qualified": o filho da raiz fica no namespace vazio.
  const declaration = purchasedServiceDeclaration(
    "DeclaracaoServicoComprado",
    invoice,
    taker,
  ).replace("<DeclaracaoServicoComprado>", '<DeclaracaoServicoComprado xmlns="">');

  return xmlDocument({
    root: "EmitirNotaServicoCompradoEnvio",
    xmlns: namespaceFor("emitir-nota-servico-comprado-envio"),
    prefixes,
    body: [declaration],
  });
}

export function sendPurchasedServiceBatchRequest(
  batch: PurchasedServiceBatch,
  taker: PartyIdentification,
): string {
  const owner = batch.taker ?? taker;
  return xmlDocument({
    root: "EnviarLoteNotaServicoCompradoEnvio",
    xmlns: namespaceFor("enviar-lote-nota-servico-comprado-envio"),
    prefixes,
    body: [
      requiredGroup(
        "LoteNotaServicoComprado",
        [
          requiredGroup(`${T}:IdentificacaoRemessa`, [
            element(`${T}:Numero`, batch.batchNumber),
          ]),
          partyGroup(`${T}:Tomador`, owner),
          batch.invoices
            .map((invoice) =>
              purchasedServiceDeclaration(
                `${T}:ListaDeclaracaoServicoComprado`,
                invoice,
                owner,
              ),
            )
            .join(""),
        ],
        { QuantidadeNotaServicoComprado: batch.invoices.length },
      ),
    ],
  });
}

export function cancelPurchasedServiceRequest(args: {
  verificationCode: string;
  taker: PartyIdentification;
  cityCode: string | number;
  cancellationCode: number;
}): string {
  return xmlDocument({
    root: "CancelarNotaServicoCompradoEnvio",
    xmlns: namespaceFor("cancelar-nota-servico-comprado-envio"),
    prefixes,
    body: [
      requiredGroup("PedidoCancelamentoNotaComprada", [
        element(`${T}:CodigoVerificacao`, args.verificationCode),
        taxIdGroup(args.taker),
        element(`${T}:InscricaoMunicipal`, args.taker.municipalRegistration),
        element(`${T}:CodigoMunicipio`, args.cityCode),
        element(`${T}:CodigoCancelamento`, args.cancellationCode),
      ]),
    ],
  });
}

interface OpenDateRange {
  from: string;
  to?: string;
}

function dateRangeGroup(tag: string, range: OpenDateRange): string {
  return requiredGroup(tag, [
    element(`${T}:DataInicial`, range.from),
    element(`${T}:DataFinal`, range.to),
  ]);
}

export function queryPurchasedByNumberRequest(args: {
  taker: PartyIdentification;
  declaredNumber?: number | string;
  declaredSeries?: string;
  competencePeriod: OpenDateRange;
  issuePeriod: OpenDateRange;
}): string {
  return xmlDocument({
    root: "ConsultarServicoCompradoPorNumeroEnvio",
    xmlns: namespaceFor("consultar-nota-servico-comprado-envio"),
    prefixes,
    body: [
      partyGroup("Tomador", args.taker),
      element("NumeroDeclarado", args.declaredNumber),
      element("SerieDeclarada", args.declaredSeries),
      dateRangeGroup("PeriodoCompetencia", args.competencePeriod),
      dateRangeGroup("PeriodoEmissao", args.issuePeriod),
    ],
  });
}

export function queryPurchasedByBatchRequest(args: {
  taker: PartyIdentification;
  protocol: string;
}): string {
  return xmlDocument({
    root: "ConsultarServicoCompradoPorLoteEnvio",
    xmlns: namespaceFor("consultar-lote-nota-servico-comprado-envio"),
    prefixes,
    body: [partyGroup("Tomador", args.taker), element("Protocolo", args.protocol)],
  });
}

export function queryPurchasedByProtocolRequest(args: {
  taker: PartyIdentification;
  protocol: string;
}): string {
  return xmlDocument({
    root: "ConsultarServicoCompradoPorProtocoloEnvio",
    xmlns: namespaceFor("consultar-protocolo-nota-servico-comprado-envio"),
    prefixes,
    body: [partyGroup("Tomador", args.taker), element("Protocolo", args.protocol)],
  });
}
