import type {
  Identificacao,
  Intermediario,
  LoteRps,
  PedidoCancelamento,
  Rps,
  Servico,
  Tomador,
  Valores,
} from "../types.ts";
import { data, documento, el, grupo, grupoObrigatorio, valor } from "../xml.ts";

/** `consultar-lote-rps-envio` → `http://www.giss.com.br/consultar-lote-rps-envio-v2_04.xsd` */
export function namespaceDe(schema: string, versao: string): string {
  return `http://www.giss.com.br/${schema}-v${versao.replace(".", "_")}.xsd`;
}

const T = "tipos"; // prefixo do namespace de tipos

function prefixos(versao: string): Record<string, string> {
  return { [T]: namespaceDe("tipos", versao) };
}

export function montarCabecalho(versao: string): string {
  return documento({
    raiz: "cabecalho",
    xmlns: namespaceDe("cabecalho", versao),
    attrs: { versao },
    corpo: [el("versaoDados", versao)],
  });
}

// ---------------------------------------------------------------------------
// Blocos reutilizáveis (todos no namespace de tipos)
// ---------------------------------------------------------------------------

function cpfCnpj(dados: { cnpj?: string; cpf?: string }): string {
  return grupoObrigatorio(`${T}:CpfCnpj`, [
    dados.cnpj ? el(`${T}:Cnpj`, dados.cnpj) : el(`${T}:Cpf`, dados.cpf),
  ]);
}

/** `tcIdentificacaoPessoaEmpresa` — a tag externa vem do schema que o utiliza. */
export function identificacao(tag: string, dados: Identificacao): string {
  return grupoObrigatorio(tag, [
    cpfCnpj(dados),
    el(`${T}:InscricaoMunicipal`, dados.inscricaoMunicipal),
  ]);
}

function endereco(dados: NonNullable<Tomador["endereco"]>): string {
  return grupoObrigatorio(`${T}:Endereco`, [
    el(`${T}:Endereco`, dados.logradouro),
    el(`${T}:Numero`, dados.numero),
    el(`${T}:Complemento`, dados.complemento),
    el(`${T}:Bairro`, dados.bairro),
    el(`${T}:CodigoMunicipio`, dados.codigoMunicipio),
    el(`${T}:Uf`, dados.uf),
    el(`${T}:Cep`, dados.cep),
  ]);
}

function contato(dados: NonNullable<Tomador["contato"]>): string {
  return grupo(`${T}:Contato`, [
    el(`${T}:Telefone`, dados.telefone),
    el(`${T}:Email`, dados.email),
  ]);
}

function identificacaoRps(tag: string, rps: NonNullable<Rps["identificacao"]>): string {
  return grupoObrigatorio(tag, [
    el(`${T}:Numero`, rps.numero),
    el(`${T}:Serie`, rps.serie),
    el(`${T}:Tipo`, rps.tipo ?? 1),
  ]);
}

function valores(dados: Valores): string {
  const pisCofins = dados.pisCofins;
  const total = dados.totalAproximadoTributos;
  const ibs = dados.ibsCbs;

  return grupoObrigatorio(`${T}:Valores`, [
    el(`${T}:ValorServicos`, valor(dados.servicos)),
    el(`${T}:ValorDeducoes`, valor(dados.deducoes)),
    el(`${T}:ValorPis`, valor(dados.pis)),
    el(`${T}:ValorCofins`, valor(dados.cofins)),
    el(`${T}:ValorInss`, valor(dados.inss)),
    el(`${T}:ValorIr`, valor(dados.ir)),
    el(`${T}:ValorCsll`, valor(dados.csll)),
    el(`${T}:OutrasRetencoes`, valor(dados.outrasRetencoes)),
    el(`${T}:ValTotTributos`, valor(dados.totalTributos)),
    el(`${T}:ValorIss`, valor(dados.iss)),
    dados.aliquota === undefined
      ? ""
      : el(`${T}:Aliquota`, Number(dados.aliquota).toFixed(2)),
    el(`${T}:DescontoIncondicionado`, valor(dados.descontoIncondicionado)),
    el(`${T}:DescontoCondicionado`, valor(dados.descontoCondicionado)),
    grupo(`${T}:trib`, [
      pisCofins &&
        grupoObrigatorio(`${T}:tribFed`, [
          grupoObrigatorio(`${T}:piscofins`, [
            el(`${T}:CST`, pisCofins.cst),
            el(`${T}:vBCPisCofins`, valor(pisCofins.baseCalculo)),
            el(`${T}:pAliqPis`, valor(pisCofins.aliquotaPis)),
            el(`${T}:pAliqCofins`, valor(pisCofins.aliquotaCofins)),
            el(`${T}:vPis`, valor(pisCofins.valorPis)),
            el(`${T}:vCofins`, valor(pisCofins.valorCofins)),
            pisCofins.tipoRetencao === undefined
              ? ""
              : el(`${T}:tpRetPisCofins`, pisCofins.tipoRetencao),
          ]),
        ]),
      total &&
        grupoObrigatorio(`${T}:totTrib`, [
          total.indicador === 0
            ? el(`${T}:indTotTrib`, 0)
            : grupo(`${T}:pTotTrib`, [
                el(`${T}:pTotTribFed`, valor(total.federal)),
                el(`${T}:pTotTribEst`, valor(total.estadual)),
                el(`${T}:pTotTribMun`, valor(total.municipal)),
              ]),
          total.simplesNacional === undefined
            ? ""
            : el(`${T}:pTotTribSN`, valor(total.simplesNacional)),
        ]),
    ]),
    ibs &&
      grupoObrigatorio(`${T}:IBSCBS`, [
        el(`${T}:finNFSe`, ibs.finalidade),
        el(`${T}:indFinal`, ibs.consumidorFinal),
        el(`${T}:cIndOp`, ibs.codigoIndicadorOperacao),
        el(`${T}:tpOper`, ibs.tipoOperacao),
        grupo(
          `${T}:gRefNFSe`,
          (ibs.referencias ?? []).map((ref) => el(`${T}:refNFSe`, ref)),
        ),
        el(`${T}:tpEnteGov`, ibs.tipoEnteGovernamental),
        el(`${T}:indDest`, ibs.indicadorDestinatario),
        grupoObrigatorio(`${T}:valores`, [
          grupoObrigatorio(`${T}:trib`, [
            grupoObrigatorio(`${T}:gIBSCBS`, [
              el(`${T}:CST`, ibs.cst),
              el(`${T}:cClassTrib`, ibs.classificacaoTributaria),
            ]),
          ]),
          el(`${T}:cLocalidadeIncid`, ibs.codigoLocalidadeIncidencia),
          el(`${T}:pRedutor`, valor(ibs.percentualRedutor)),
          el(`${T}:vBC`, valor(ibs.baseCalculo)),
        ]),
      ]),
  ]);
}

function servico(dados: Servico): string {
  return grupoObrigatorio(`${T}:Servico`, [
    valores(dados.valores),
    el(`${T}:IssRetido`, dados.issRetido),
    el(`${T}:ResponsavelRetencao`, dados.responsavelRetencao),
    el(`${T}:ItemListaServico`, dados.itemListaServico),
    el(`${T}:CodigoCnae`, dados.codigoCnae),
    el(`${T}:CodigoTributacaoMunicipio`, dados.codigoTributacaoMunicipio),
    el(`${T}:CodigoNbs`, dados.codigoNbs),
    el(`${T}:Discriminacao`, dados.discriminacao),
    el(`${T}:CodigoMunicipio`, dados.codigoMunicipio),
    el(`${T}:CodigoPais`, dados.codigoPais),
    el(`${T}:ExigibilidadeISS`, dados.exigibilidadeIss),
    el(`${T}:IdentifNaoExigibilidade`, dados.identificacaoNaoExigibilidade),
    el(`${T}:MunicipioIncidencia`, dados.municipioIncidencia),
    el(`${T}:NumeroProcesso`, dados.numeroProcesso),
  ]);
}

function tomador(dados: Tomador): string {
  return grupoObrigatorio(`${T}:TomadorServico`, [
    dados.cnpj || dados.cpf
      ? identificacao(`${T}:IdentificacaoTomador`, dados)
      : "",
    el(`${T}:NifTomador`, dados.nif),
    el(`${T}:RazaoSocial`, dados.razaoSocial),
    dados.endereco ? endereco(dados.endereco) : "",
    dados.contato ? contato(dados.contato) : "",
  ]);
}

function intermediario(dados: Intermediario): string {
  return grupoObrigatorio(`${T}:Intermediario`, [
    identificacao(`${T}:IdentificacaoIntermediario`, dados),
    el(`${T}:RazaoSocial`, dados.razaoSocial),
    el(`${T}:CodigoMunicipio`, dados.codigoMunicipio),
  ]);
}

/** Gera o Id do grupo assinado, estável para o mesmo RPS. */
export function idDoRps(rps: Rps): string {
  if (rps.id) return rps.id;
  if (rps.identificacao) {
    return `rps${rps.identificacao.serie}${rps.identificacao.numero}`;
  }
  return `rps${data(rps.competencia).replace(/-/g, "")}`;
}

/** `tcDeclaracaoPrestacaoServico` — usado por GerarNfse, lote de RPS e substituição. */
export function declaracaoPrestacaoServico(
  tag: string,
  rps: Rps,
  prestadorPadrao: Identificacao,
): string {
  const id = idDoRps(rps);
  const identificacaoRpsGrupo = rps.identificacao
    ? grupoObrigatorio(
        `${T}:Rps`,
        [
          identificacaoRps(`${T}:IdentificacaoRps`, rps.identificacao),
          el(`${T}:DataEmissao`, data(rps.dataEmissao ?? new Date())),
          el(`${T}:Status`, rps.status ?? 1),
          rps.rpsSubstituido
            ? identificacaoRps(`${T}:RpsSubstituido`, rps.rpsSubstituido)
            : "",
        ],
        { Id: `${id}i` },
      )
    : "";

  return grupoObrigatorio(tag, [
    grupoObrigatorio(
      `${T}:InfDeclaracaoPrestacaoServico`,
      [
        identificacaoRpsGrupo,
        el(`${T}:Competencia`, data(rps.competencia)),
        servico(rps.servico),
        identificacao(`${T}:Prestador`, rps.prestador ?? prestadorPadrao),
        rps.tomador ? tomador(rps.tomador) : "",
        rps.intermediario ? intermediario(rps.intermediario) : "",
        rps.construcaoCivil
          ? grupo(`${T}:ConstrucaoCivil`, [
              el(`${T}:CodigoObra`, rps.construcaoCivil.codigoObra),
              el(`${T}:Art`, rps.construcaoCivil.art),
            ])
          : "",
        el(`${T}:RegimeEspecialTributacao`, rps.regimeEspecialTributacao),
        el(`${T}:OptanteSimplesNacional`, rps.optanteSimplesNacional),
        el(`${T}:IncentivoFiscal`, rps.incentivoFiscal),
        el(`${T}:InformacoesComplementares`, rps.informacoesComplementares),
      ],
      { Id: id },
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Mensagens de envio
// ---------------------------------------------------------------------------

export function gerarNfseEnvio(
  rps: Rps,
  prestador: Identificacao,
  versao: string,
): string {
  return documento({
    raiz: "GerarNfseEnvio",
    xmlns: namespaceDe("gerar-nfse-envio", versao),
    prefixos: prefixos(versao),
    corpo: [declaracaoPrestacaoServico("Rps", rps, prestador)],
  });
}

function loteRpsCorpo(
  lote: LoteRps,
  prestador: Identificacao,
  versao: string,
): string {
  return grupoObrigatorio(
    "LoteRps",
    [
      el(`${T}:NumeroLote`, lote.numeroLote),
      identificacao(`${T}:Prestador`, lote.prestador ?? prestador),
      el(`${T}:QuantidadeRps`, lote.rps.length),
      grupoObrigatorio(`${T}:ListaRps`, [
        lote.rps
          .map((rps) =>
            declaracaoPrestacaoServico(`${T}:Rps`, rps, lote.prestador ?? prestador),
          )
          .join(""),
      ]),
    ],
    { Id: lote.id ?? `lote${lote.numeroLote}`, versao },
  );
}

export function enviarLoteRpsEnvio(
  lote: LoteRps,
  prestador: Identificacao,
  versao: string,
): string {
  return documento({
    raiz: "EnviarLoteRpsEnvio",
    xmlns: namespaceDe("enviar-lote-rps-envio", versao),
    prefixos: prefixos(versao),
    corpo: [loteRpsCorpo(lote, prestador, versao)],
  });
}

export function enviarLoteRpsSincronoEnvio(
  lote: LoteRps,
  prestador: Identificacao,
  versao: string,
): string {
  return documento({
    raiz: "EnviarLoteRpsSincronoEnvio",
    xmlns: namespaceDe("enviar-lote-rps-sincrono-envio", versao),
    prefixos: prefixos(versao),
    corpo: [loteRpsCorpo(lote, prestador, versao)],
  });
}

/** `tcPedidoCancelamento` — reaproveitado por CancelarNfse e SubstituirNfse. */
export function pedidoCancelamento(
  tag: string,
  pedido: PedidoCancelamento,
  prestador: Identificacao,
  codigoMunicipioPadrao: string | number,
): string {
  const dados = pedido.prestador ?? prestador;
  return grupoObrigatorio(tag, [
    grupoObrigatorio(
      `${T}:InfPedidoCancelamento`,
      [
        grupoObrigatorio(`${T}:IdentificacaoNfse`, [
          el(`${T}:Numero`, pedido.numeroNfse),
          cpfCnpj(dados),
          el(`${T}:InscricaoMunicipal`, dados.inscricaoMunicipal),
          el(
            `${T}:CodigoMunicipio`,
            pedido.codigoMunicipio ?? codigoMunicipioPadrao,
          ),
        ]),
        el(`${T}:CodigoCancelamento`, pedido.codigoCancelamento),
      ],
      { Id: pedido.id ?? `canc${pedido.numeroNfse}` },
    ),
  ]);
}

export function cancelarNfseEnvio(
  pedido: PedidoCancelamento,
  prestador: Identificacao,
  codigoMunicipio: string | number,
  versao: string,
): string {
  return documento({
    raiz: "CancelarNfseEnvio",
    xmlns: namespaceDe("cancelar-nfse-envio", versao),
    prefixos: prefixos(versao),
    corpo: [pedidoCancelamento("Pedido", pedido, prestador, codigoMunicipio)],
  });
}

export function substituirNfseEnvio(
  pedido: PedidoCancelamento,
  rps: Rps,
  prestador: Identificacao,
  codigoMunicipio: string | number,
  versao: string,
): string {
  // O XSD de substituição declara targetNamespace de gerar-nfse-resposta — não é
  // engano de transcrição, é o que o schema publicado traz.
  return documento({
    raiz: "SubstituirNfseEnvio",
    xmlns: namespaceDe("gerar-nfse-resposta", versao),
    prefixos: prefixos(versao),
    corpo: [
      grupoObrigatorio(
        "SubstituicaoNfse",
        [
          pedidoCancelamento("Pedido", pedido, prestador, codigoMunicipio),
          declaracaoPrestacaoServico("Rps", rps, prestador),
        ],
        { Id: `subst${pedido.numeroNfse}` },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function consultarLoteRpsEnvio(args: {
  prestador: Identificacao;
  protocolo: string;
  versao: string;
}): string {
  return documento({
    raiz: "ConsultarLoteRpsEnvio",
    xmlns: namespaceDe("consultar-lote-rps-envio", args.versao),
    prefixos: prefixos(args.versao),
    corpo: [
      identificacao("Prestador", args.prestador),
      el("Protocolo", args.protocolo),
    ],
  });
}

export function consultarNfseFaixaEnvio(args: {
  prestador: Identificacao;
  numeroInicial: number | string;
  numeroFinal: number | string;
  pagina?: number;
  versao: string;
}): string {
  return documento({
    raiz: "ConsultarNfseFaixaEnvio",
    xmlns: namespaceDe("consultar-nfse-faixa-envio", args.versao),
    prefixos: prefixos(args.versao),
    corpo: [
      identificacao("Prestador", args.prestador),
      grupoObrigatorio("Faixa", [
        el("NumeroNfseInicial", args.numeroInicial),
        el("NumeroNfseFinal", args.numeroFinal),
      ]),
      el("Pagina", args.pagina ?? 1),
    ],
  });
}

export function consultarNfseRpsEnvio(args: {
  prestador: Identificacao;
  numero: number | string;
  serie: string;
  tipo?: 1 | 2 | 3;
  versao: string;
}): string {
  return documento({
    raiz: "ConsultarNfseRpsEnvio",
    xmlns: namespaceDe("consultar-nfse-rps-envio", args.versao),
    prefixos: prefixos(args.versao),
    corpo: [
      identificacaoRps("IdentificacaoRps", {
        numero: args.numero,
        serie: args.serie,
        tipo: args.tipo ?? 1,
      }),
      identificacao("Prestador", args.prestador),
    ],
  });
}

interface Periodo {
  inicial: string;
  final: string;
}

function periodo(tag: string, valores: Periodo): string {
  return grupoObrigatorio(tag, [
    el("DataInicial", valores.inicial),
    el("DataFinal", valores.final),
  ]);
}

function filtroPeriodo(args: {
  numeroNfse?: number | string;
  periodoEmissao?: Periodo;
  periodoCompetencia?: Periodo;
}): string {
  if (args.numeroNfse) return el("NumeroNfse", args.numeroNfse);
  if (args.periodoEmissao) return periodo("PeriodoEmissao", args.periodoEmissao);
  if (args.periodoCompetencia) {
    return periodo("PeriodoCompetencia", args.periodoCompetencia);
  }
  throw new Error(
    "Informe numeroNfse, periodoEmissao ou periodoCompetencia na consulta",
  );
}

export function consultarNfseServicoPrestadoEnvio(args: {
  prestador: Identificacao;
  numeroNfse?: number | string;
  periodoEmissao?: Periodo;
  periodoCompetencia?: Periodo;
  tomador?: Identificacao;
  intermediario?: Identificacao;
  pagina?: number;
  versao: string;
}): string {
  return documento({
    raiz: "ConsultarNfseServicoPrestadoEnvio",
    xmlns: namespaceDe("consultar-nfse-servico-prestado-envio", args.versao),
    prefixos: prefixos(args.versao),
    corpo: [
      identificacao("Prestador", args.prestador),
      filtroPeriodo(args),
      args.tomador ? identificacao("Tomador", args.tomador) : "",
      args.intermediario ? identificacao("Intermediario", args.intermediario) : "",
      el("Pagina", args.pagina ?? 1),
    ],
  });
}

export function consultarNfseServicoTomadoEnvio(args: {
  consulente: Identificacao;
  numeroNfse?: number | string;
  periodoEmissao?: Periodo;
  periodoCompetencia?: Periodo;
  prestador?: Identificacao;
  tomador?: Identificacao;
  intermediario?: Identificacao;
  pagina?: number;
  versao: string;
}): string {
  return documento({
    raiz: "ConsultarNfseServicoTomadoEnvio",
    xmlns: namespaceDe("consultar-nfse-servico-tomado-envio", args.versao),
    prefixos: prefixos(args.versao),
    corpo: [
      identificacao("Consulente", args.consulente),
      filtroPeriodo(args),
      args.prestador ? identificacao("Prestador", args.prestador) : "",
      args.tomador ? identificacao("Tomador", args.tomador) : "",
      args.intermediario ? identificacao("Intermediario", args.intermediario) : "",
      el("Pagina", args.pagina ?? 1),
    ],
  });
}
