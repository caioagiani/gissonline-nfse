import type {
  Amounts,
  CancellationRequest,
  DateRange,
  Intermediary,
  PartyIdentification,
  Rps,
  RpsBatch,
  RpsIdentification,
  Service,
  ServiceTaker,
} from "../domain/types.ts";
import {
  amount,
  element,
  group,
  isoDate,
  requiredGroup,
  xmlDocument,
} from "../infra/xml.ts";

/** Builders das mensagens do serviço `nfse` (serviços prestados). */

/** `consultar-lote-rps-envio` → `http://www.giss.com.br/consultar-lote-rps-envio-v2_04.xsd` */
export function namespaceFor(schema: string, version: string): string {
  return `http://www.giss.com.br/${schema}-v${version.replace(".", "_")}.xsd`;
}

const T = "tipos"; // prefixo do namespace de tipos

const typePrefixes = (version: string): Record<string, string> => ({
  [T]: namespaceFor("tipos", version),
});

export function buildHeader(version: string): string {
  return xmlDocument({
    root: "cabecalho",
    xmlns: namespaceFor("cabecalho", version),
    attributes: { versao: version },
    body: [element("versaoDados", version)],
  });
}

// ---------------------------------------------------------------------------
// Blocos reutilizáveis (todos no namespace de tipos)
// ---------------------------------------------------------------------------

function taxIdGroup(party: { cnpj?: string; cpf?: string }): string {
  return requiredGroup(`${T}:CpfCnpj`, [
    party.cnpj ? element(`${T}:Cnpj`, party.cnpj) : element(`${T}:Cpf`, party.cpf),
  ]);
}

/** `tcIdentificacaoPessoaEmpresa` — a tag externa vem do schema que o utiliza. */
export function partyGroup(tag: string, party: PartyIdentification): string {
  return requiredGroup(tag, [
    taxIdGroup(party),
    element(`${T}:InscricaoMunicipal`, party.municipalRegistration),
  ]);
}

function addressGroup(address: NonNullable<ServiceTaker["address"]>): string {
  return requiredGroup(`${T}:Endereco`, [
    element(`${T}:Endereco`, address.street),
    element(`${T}:Numero`, address.number),
    element(`${T}:Complemento`, address.complement),
    element(`${T}:Bairro`, address.district),
    element(`${T}:CodigoMunicipio`, address.cityCode),
    element(`${T}:Uf`, address.state),
    element(`${T}:Cep`, address.zipCode),
  ]);
}

function contactGroup(contact: NonNullable<ServiceTaker["contact"]>): string {
  return group(`${T}:Contato`, [
    element(`${T}:Telefone`, contact.phone),
    element(`${T}:Email`, contact.email),
  ]);
}

function rpsIdGroup(tag: string, rps: RpsIdentification): string {
  return requiredGroup(tag, [
    element(`${T}:Numero`, rps.number),
    element(`${T}:Serie`, rps.series),
    element(`${T}:Tipo`, rps.type ?? 1),
  ]);
}

function amountsGroup(amounts: Amounts): string {
  const pisCofins = amounts.pisCofins;
  const total = amounts.approximateTaxes;
  const ibs = amounts.ibsCbs;

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
    group(`${T}:trib`, [
      pisCofins &&
        requiredGroup(`${T}:tribFed`, [
          requiredGroup(`${T}:piscofins`, [
            element(`${T}:CST`, pisCofins.cst),
            element(`${T}:vBCPisCofins`, amount(pisCofins.taxableAmount)),
            element(`${T}:pAliqPis`, amount(pisCofins.pisRate)),
            element(`${T}:pAliqCofins`, amount(pisCofins.cofinsRate)),
            element(`${T}:vPis`, amount(pisCofins.pisAmount)),
            element(`${T}:vCofins`, amount(pisCofins.cofinsAmount)),
            pisCofins.withholdingType === undefined
              ? ""
              : element(`${T}:tpRetPisCofins`, pisCofins.withholdingType),
          ]),
        ]),
      total &&
        requiredGroup(`${T}:totTrib`, [
          total.indicator === 0
            ? element(`${T}:indTotTrib`, 0)
            : group(`${T}:pTotTrib`, [
                element(`${T}:pTotTribFed`, amount(total.federal)),
                element(`${T}:pTotTribEst`, amount(total.state)),
                element(`${T}:pTotTribMun`, amount(total.municipal)),
              ]),
          total.simplesNacional === undefined
            ? ""
            : element(`${T}:pTotTribSN`, amount(total.simplesNacional)),
        ]),
    ]),
    ibs &&
      requiredGroup(`${T}:IBSCBS`, [
        element(`${T}:finNFSe`, ibs.purpose),
        element(`${T}:indFinal`, ibs.endConsumer),
        element(`${T}:cIndOp`, ibs.operationIndicator),
        element(`${T}:tpOper`, ibs.operationType),
        group(
          `${T}:gRefNFSe`,
          (ibs.references ?? []).map((ref) => element(`${T}:refNFSe`, ref)),
        ),
        element(`${T}:tpEnteGov`, ibs.governmentEntityType),
        element(`${T}:indDest`, ibs.recipientIndicator),
        requiredGroup(`${T}:valores`, [
          requiredGroup(`${T}:trib`, [
            requiredGroup(`${T}:gIBSCBS`, [
              element(`${T}:CST`, ibs.cst),
              element(`${T}:cClassTrib`, ibs.taxClassification),
            ]),
          ]),
          element(`${T}:cLocalidadeIncid`, ibs.incidenceLocationCode),
          element(`${T}:pRedutor`, amount(ibs.reductionRate)),
          element(`${T}:vBC`, amount(ibs.taxableAmount)),
        ]),
      ]),
  ]);
}

function serviceGroup(service: Service): string {
  return requiredGroup(`${T}:Servico`, [
    amountsGroup(service.amounts),
    element(`${T}:IssRetido`, service.issWithheld),
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
    element(`${T}:NumeroProcesso`, service.processNumber),
  ]);
}

function takerGroup(taker: ServiceTaker): string {
  return requiredGroup(`${T}:TomadorServico`, [
    taker.cnpj || taker.cpf ? partyGroup(`${T}:IdentificacaoTomador`, taker) : "",
    element(`${T}:NifTomador`, taker.nif),
    element(`${T}:RazaoSocial`, taker.legalName),
    taker.address ? addressGroup(taker.address) : "",
    taker.contact ? contactGroup(taker.contact) : "",
  ]);
}

function intermediaryGroup(intermediary: Intermediary): string {
  return requiredGroup(`${T}:Intermediario`, [
    partyGroup(`${T}:IdentificacaoIntermediario`, intermediary),
    element(`${T}:RazaoSocial`, intermediary.legalName),
    element(`${T}:CodigoMunicipio`, intermediary.cityCode),
  ]);
}

/** Id do grupo assinado, estável para o mesmo RPS. */
export function rpsId(rps: Rps): string {
  if (rps.id) return rps.id;
  if (rps.identification) {
    return `rps${rps.identification.series}${rps.identification.number}`;
  }
  return `rps${isoDate(rps.competenceDate).replace(/-/g, "")}`;
}

export function batchId(batch: RpsBatch): string {
  return batch.id ?? `lote${batch.batchNumber}`;
}

export function cancellationId(request: CancellationRequest): string {
  return request.id ?? `canc${request.nfseNumber}`;
}

/** `tcDeclaracaoPrestacaoServico` — usado por GerarNfse, lote e substituição. */
export function serviceDeclaration(
  tag: string,
  rps: Rps,
  defaultProvider: PartyIdentification,
): string {
  const id = rpsId(rps);
  const rpsGroup = rps.identification
    ? requiredGroup(
        `${T}:Rps`,
        [
          rpsIdGroup(`${T}:IdentificacaoRps`, rps.identification),
          element(`${T}:DataEmissao`, isoDate(rps.issueDate ?? new Date())),
          element(`${T}:Status`, rps.status ?? 1),
          rps.replacedRps ? rpsIdGroup(`${T}:RpsSubstituido`, rps.replacedRps) : "",
        ],
        { Id: `${id}i` },
      )
    : "";

  return requiredGroup(tag, [
    requiredGroup(
      `${T}:InfDeclaracaoPrestacaoServico`,
      [
        rpsGroup,
        element(`${T}:Competencia`, isoDate(rps.competenceDate)),
        serviceGroup(rps.service),
        partyGroup(`${T}:Prestador`, rps.provider ?? defaultProvider),
        rps.taker ? takerGroup(rps.taker) : "",
        rps.intermediary ? intermediaryGroup(rps.intermediary) : "",
        rps.construction
          ? group(`${T}:ConstrucaoCivil`, [
              element(`${T}:CodigoObra`, rps.construction.workCode),
              element(`${T}:Art`, rps.construction.art),
            ])
          : "",
        element(`${T}:RegimeEspecialTributacao`, rps.specialTaxRegime),
        element(`${T}:OptanteSimplesNacional`, rps.simplesNacionalOptant),
        element(`${T}:IncentivoFiscal`, rps.taxIncentive),
        element(`${T}:InformacoesComplementares`, rps.additionalInformation),
      ],
      { Id: id },
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Mensagens de envio
// ---------------------------------------------------------------------------

export function generateNfseRequest(
  rps: Rps,
  provider: PartyIdentification,
  version: string,
): string {
  return xmlDocument({
    root: "GerarNfseEnvio",
    xmlns: namespaceFor("gerar-nfse-envio", version),
    prefixes: typePrefixes(version),
    body: [serviceDeclaration("Rps", rps, provider)],
  });
}

function batchBody(
  batch: RpsBatch,
  provider: PartyIdentification,
  version: string,
): string {
  const owner = batch.provider ?? provider;
  return requiredGroup(
    "LoteRps",
    [
      element(`${T}:NumeroLote`, batch.batchNumber),
      partyGroup(`${T}:Prestador`, owner),
      element(`${T}:QuantidadeRps`, batch.rps.length),
      requiredGroup(`${T}:ListaRps`, [
        batch.rps.map((rps) => serviceDeclaration(`${T}:Rps`, rps, owner)).join(""),
      ]),
    ],
    { Id: batchId(batch), versao: version },
  );
}

export function sendRpsBatchRequest(
  batch: RpsBatch,
  provider: PartyIdentification,
  version: string,
): string {
  return xmlDocument({
    root: "EnviarLoteRpsEnvio",
    xmlns: namespaceFor("enviar-lote-rps-envio", version),
    prefixes: typePrefixes(version),
    body: [batchBody(batch, provider, version)],
  });
}

export function sendRpsBatchSyncRequest(
  batch: RpsBatch,
  provider: PartyIdentification,
  version: string,
): string {
  return xmlDocument({
    root: "EnviarLoteRpsSincronoEnvio",
    xmlns: namespaceFor("enviar-lote-rps-sincrono-envio", version),
    prefixes: typePrefixes(version),
    body: [batchBody(batch, provider, version)],
  });
}

/** `tcPedidoCancelamento` — reaproveitado por CancelarNfse e SubstituirNfse. */
export function cancellationRequestGroup(
  tag: string,
  request: CancellationRequest,
  provider: PartyIdentification,
  defaultCityCode: string | number,
): string {
  const party = request.provider ?? provider;
  return requiredGroup(tag, [
    requiredGroup(
      `${T}:InfPedidoCancelamento`,
      [
        requiredGroup(`${T}:IdentificacaoNfse`, [
          element(`${T}:Numero`, request.nfseNumber),
          taxIdGroup(party),
          element(`${T}:InscricaoMunicipal`, party.municipalRegistration),
          element(`${T}:CodigoMunicipio`, request.cityCode ?? defaultCityCode),
        ]),
        element(`${T}:CodigoCancelamento`, request.cancellationCode),
      ],
      { Id: cancellationId(request) },
    ),
  ]);
}

export function cancelNfseRequest(
  request: CancellationRequest,
  provider: PartyIdentification,
  cityCode: string | number,
  version: string,
): string {
  return xmlDocument({
    root: "CancelarNfseEnvio",
    xmlns: namespaceFor("cancelar-nfse-envio", version),
    prefixes: typePrefixes(version),
    body: [cancellationRequestGroup("Pedido", request, provider, cityCode)],
  });
}

export function replacementId(request: CancellationRequest): string {
  return `subst${request.nfseNumber}`;
}

export function replaceNfseRequest(
  request: CancellationRequest,
  rps: Rps,
  provider: PartyIdentification,
  cityCode: string | number,
  version: string,
): string {
  // O XSD de substituição declara targetNamespace de gerar-nfse-resposta — não é
  // engano de transcrição, é o que o schema publicado traz.
  return xmlDocument({
    root: "SubstituirNfseEnvio",
    xmlns: namespaceFor("gerar-nfse-resposta", version),
    prefixes: typePrefixes(version),
    body: [
      requiredGroup(
        "SubstituicaoNfse",
        [
          cancellationRequestGroup("Pedido", request, provider, cityCode),
          serviceDeclaration("Rps", rps, provider),
        ],
        { Id: replacementId(request) },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function queryRpsBatchRequest(args: {
  provider: PartyIdentification;
  protocol: string;
  version: string;
}): string {
  return xmlDocument({
    root: "ConsultarLoteRpsEnvio",
    xmlns: namespaceFor("consultar-lote-rps-envio", args.version),
    prefixes: typePrefixes(args.version),
    body: [
      partyGroup("Prestador", args.provider),
      element("Protocolo", args.protocol),
    ],
  });
}

export function queryNfseRangeRequest(args: {
  provider: PartyIdentification;
  firstNumber: number | string;
  lastNumber: number | string;
  page?: number;
  version: string;
}): string {
  return xmlDocument({
    root: "ConsultarNfseFaixaEnvio",
    xmlns: namespaceFor("consultar-nfse-faixa-envio", args.version),
    prefixes: typePrefixes(args.version),
    body: [
      partyGroup("Prestador", args.provider),
      requiredGroup("Faixa", [
        element("NumeroNfseInicial", args.firstNumber),
        element("NumeroNfseFinal", args.lastNumber),
      ]),
      element("Pagina", args.page ?? 1),
    ],
  });
}

export function queryNfseByRpsRequest(args: {
  provider: PartyIdentification;
  number: number | string;
  series: string;
  type?: 1 | 2 | 3;
  version: string;
}): string {
  return xmlDocument({
    root: "ConsultarNfseRpsEnvio",
    xmlns: namespaceFor("consultar-nfse-rps-envio", args.version),
    prefixes: typePrefixes(args.version),
    body: [
      rpsIdGroup("IdentificacaoRps", {
        number: args.number,
        series: args.series,
        type: args.type ?? 1,
      }),
      partyGroup("Prestador", args.provider),
    ],
  });
}

function dateRangeGroup(tag: string, range: DateRange): string {
  return requiredGroup(tag, [
    element("DataInicial", range.from),
    element("DataFinal", range.to),
  ]);
}

interface PeriodFilter {
  nfseNumber?: number | string;
  issuePeriod?: DateRange;
  competencePeriod?: DateRange;
}

function periodFilter(args: PeriodFilter): string {
  if (args.nfseNumber) return element("NumeroNfse", args.nfseNumber);
  if (args.issuePeriod) return dateRangeGroup("PeriodoEmissao", args.issuePeriod);
  if (args.competencePeriod) {
    return dateRangeGroup("PeriodoCompetencia", args.competencePeriod);
  }
  throw new Error(
    "Informe nfseNumber, issuePeriod ou competencePeriod na consulta",
  );
}

export interface ProvidedServicesQuery extends PeriodFilter {
  provider: PartyIdentification;
  taker?: PartyIdentification;
  intermediary?: PartyIdentification;
  page?: number;
  version: string;
}

export function queryProvidedServicesRequest(
  args: ProvidedServicesQuery,
): string {
  return xmlDocument({
    root: "ConsultarNfseServicoPrestadoEnvio",
    xmlns: namespaceFor("consultar-nfse-servico-prestado-envio", args.version),
    prefixes: typePrefixes(args.version),
    body: [
      partyGroup("Prestador", args.provider),
      periodFilter(args),
      args.taker ? partyGroup("Tomador", args.taker) : "",
      args.intermediary ? partyGroup("Intermediario", args.intermediary) : "",
      element("Pagina", args.page ?? 1),
    ],
  });
}

export interface TakenServicesQuery extends PeriodFilter {
  requester: PartyIdentification;
  provider?: PartyIdentification;
  taker?: PartyIdentification;
  intermediary?: PartyIdentification;
  page?: number;
  version: string;
}

export function queryTakenServicesRequest(args: TakenServicesQuery): string {
  return xmlDocument({
    root: "ConsultarNfseServicoTomadoEnvio",
    xmlns: namespaceFor("consultar-nfse-servico-tomado-envio", args.version),
    prefixes: typePrefixes(args.version),
    body: [
      partyGroup("Consulente", args.requester),
      periodFilter(args),
      args.provider ? partyGroup("Prestador", args.provider) : "",
      args.taker ? partyGroup("Tomador", args.taker) : "",
      args.intermediary ? partyGroup("Intermediario", args.intermediary) : "",
      element("Pagina", args.page ?? 1),
    ],
  });
}
