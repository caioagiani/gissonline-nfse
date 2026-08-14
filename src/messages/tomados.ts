import type {
  Fornecedor,
  Identificacao,
  LoteServicoComprado,
  ServicoComprado,
  ServicoCompradoDados,
  Valores,
} from "../types.ts";
import { data, documento, el, grupo, grupoObrigatorio, valor } from "../xml.ts";

/** Serviço `nfsc` (notas de serviço comprado). Os schemas são versão 1.00. */
const VERSAO = "1_00";
const NS_TIPOS = `http://www.giss.com.br/tipos-servicos-comprados-v${VERSAO}.xsd`;
const T = "tipos";

function namespaceDe(schema: string): string {
  return `http://www.giss.com.br/${schema}-v${VERSAO}.xsd`;
}

const prefixos = { [T]: NS_TIPOS };

function cpfCnpj(dados: { cnpj?: string; cpf?: string }): string {
  return grupoObrigatorio(`${T}:CpfCnpj`, [
    dados.cnpj ? el(`${T}:Cnpj`, dados.cnpj) : el(`${T}:Cpf`, dados.cpf),
  ]);
}

function identificacao(tag: string, dados: Identificacao): string {
  return grupoObrigatorio(tag, [
    cpfCnpj(dados),
    el(`${T}:InscricaoMunicipal`, dados.inscricaoMunicipal),
  ]);
}

function fornecedor(dados: Fornecedor): string {
  return grupoObrigatorio(`${T}:DadosPrestador`, [
    identificacao(`${T}:Identificacao`, dados),
    el(`${T}:NifTomador`, dados.nif),
    el(`${T}:NomeFantasia`, dados.nomeFantasia),
    el(`${T}:RazaoSocial`, dados.razaoSocial),
    dados.endereco
      ? grupoObrigatorio(`${T}:Endereco`, [
          el(`${T}:Endereco`, dados.endereco.logradouro),
          el(`${T}:Numero`, dados.endereco.numero),
          el(`${T}:Complemento`, dados.endereco.complemento),
          el(`${T}:Bairro`, dados.endereco.bairro),
          el(`${T}:CodigoMunicipio`, dados.endereco.codigoMunicipio),
          el(`${T}:Uf`, dados.endereco.uf),
          el(`${T}:Cep`, dados.endereco.cep),
        ])
      : "",
    dados.contato
      ? grupo(`${T}:Contato`, [
          el(`${T}:Telefone`, dados.contato.telefone),
          el(`${T}:Email`, dados.contato.email),
        ])
      : "",
    el(`${T}:RegimeEspecialTributacao`, dados.regimeEspecialTributacao),
    el(`${T}:OptanteSimplesNacional`, dados.optanteSimplesNacional),
  ]);
}

function valores(dados: Valores): string {
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
  ]);
}

function servico(dados: ServicoCompradoDados): string {
  const pisCofins = dados.valores.pisCofins;
  const ibs = dados.valores.ibsCbs;
  return grupoObrigatorio(`${T}:DadosServicoComprado`, [
    valores(dados.valores),
    dados.issRetido === undefined ? "" : el(`${T}:IssRetido`, String(dados.issRetido)),
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
    pisCofins
      ? grupoObrigatorio(`${T}:piscofins`, [
          el(`${T}:CST`, pisCofins.cst),
          el(`${T}:vBCPisCofins`, valor(pisCofins.baseCalculo)),
          el(`${T}:pAliqPis`, valor(pisCofins.aliquotaPis)),
          el(`${T}:pAliqCofins`, valor(pisCofins.aliquotaCofins)),
          el(`${T}:vPis`, valor(pisCofins.valorPis)),
          el(`${T}:vCofins`, valor(pisCofins.valorCofins)),
          pisCofins.tipoRetencao === undefined
            ? ""
            : el(`${T}:tpRetPisCofins`, pisCofins.tipoRetencao),
        ])
      : "",
    el(`${T}:finNFSe`, dados.finalidade),
    // O IBSCBS de serviços comprados tem estrutura própria — mais rasa que a de
    // serviços prestados, e com `cindOp` em minúscula.
    ibs
      ? grupoObrigatorio(`${T}:IBSCBS`, [
          el(`${T}:indFinal`, ibs.consumidorFinal),
          el(`${T}:cindOp`, ibs.codigoIndicadorOperacao),
          el(`${T}:tpOper`, ibs.tipoOperacao),
          (ibs.referencias ?? []).map((ref) => el(`${T}:refNFSe`, ref)).join(""),
          el(`${T}:indDest`, ibs.indicadorDestinatario),
          grupoObrigatorio(`${T}:gIBSCBS`, [
            el(`${T}:CST`, ibs.cst),
            el(`${T}:cClassTrib`, ibs.classificacaoTributaria),
            el(`${T}:cLocalidadeIncid`, ibs.codigoLocalidadeIncidencia),
            el(`${T}:pRedutor`, valor(ibs.percentualRedutor)),
            el(`${T}:vBC`, valor(ibs.baseCalculo)),
          ]),
        ])
      : "",
  ]);
}

/** `DeclaracaoServicoComprado` — uma nota de fornecedor. */
export function declaracaoServicoComprado(
  tag: string,
  nota: ServicoComprado,
  tomadorPadrao: Identificacao,
): string {
  return grupoObrigatorio(tag, [
    el(`${T}:TipoDeclaracaoNota`, nota.tipoDeclaracao),
    grupoObrigatorio(`${T}:IdentificacaoDeclaracao`, [
      el(`${T}:Numero`, nota.identificacao.numero),
      el(`${T}:NumeroDeclarado`, nota.identificacao.numeroDeclarado),
      el(`${T}:Serie`, nota.identificacao.serie),
      el(`${T}:SerieDeclarada`, nota.identificacao.serieDeclarada),
      el(`${T}:Tipo`, nota.identificacao.tipo),
    ]),
    el(`${T}:ChaveNotaNacional`, nota.chaveNotaNacional),
    el(`${T}:DataEmissao`, data(nota.dataEmissao)),
    el(`${T}:Competencia`, data(nota.competencia)),
    identificacao(`${T}:DadosTomador`, nota.tomador ?? tomadorPadrao),
    fornecedor(nota.fornecedor),
    servico(nota.servico),
    nota.construcaoCivil
      ? grupo(`${T}:DadosConstrucaoCivil`, [
          el(`${T}:CodigoObra`, nota.construcaoCivil.codigoObra),
          el(`${T}:Art`, nota.construcaoCivil.art),
        ])
      : "",
  ]);
}

export function emitirNotaServicoCompradoEnvio(
  nota: ServicoComprado,
  tomador: Identificacao,
): string {
  // `emitir-nota-servico-comprado-envio` é o único schema do pacote sem
  // elementFormDefault="qualified": o filho da raiz fica no namespace vazio.
  const declaracao = declaracaoServicoComprado(
    "DeclaracaoServicoComprado",
    nota,
    tomador,
  ).replace("<DeclaracaoServicoComprado>", '<DeclaracaoServicoComprado xmlns="">');

  return documento({
    raiz: "EmitirNotaServicoCompradoEnvio",
    xmlns: namespaceDe("emitir-nota-servico-comprado-envio"),
    prefixos,
    corpo: [declaracao],
  });
}

export function enviarLoteNotaServicoCompradoEnvio(
  lote: LoteServicoComprado,
  tomador: Identificacao,
): string {
  const consulente = lote.tomador ?? tomador;
  return documento({
    raiz: "EnviarLoteNotaServicoCompradoEnvio",
    xmlns: namespaceDe("enviar-lote-nota-servico-comprado-envio"),
    prefixos,
    corpo: [
      grupoObrigatorio(
        "LoteNotaServicoComprado",
        [
          grupoObrigatorio(`${T}:IdentificacaoRemessa`, [
            el(`${T}:Numero`, lote.numeroRemessa),
          ]),
          identificacao(`${T}:Tomador`, consulente),
          lote.notas
            .map((nota) =>
              declaracaoServicoComprado(
                `${T}:ListaDeclaracaoServicoComprado`,
                nota,
                consulente,
              ),
            )
            .join(""),
        ],
        { QuantidadeNotaServicoComprado: lote.notas.length },
      ),
    ],
  });
}

export function cancelarNotaServicoCompradoEnvio(args: {
  codigoVerificacao: string;
  tomador: Identificacao;
  codigoMunicipio: string | number;
  codigoCancelamento: number;
}): string {
  return documento({
    raiz: "CancelarNotaServicoCompradoEnvio",
    xmlns: namespaceDe("cancelar-nota-servico-comprado-envio"),
    prefixos,
    corpo: [
      grupoObrigatorio("PedidoCancelamentoNotaComprada", [
        el(`${T}:CodigoVerificacao`, args.codigoVerificacao),
        cpfCnpj(args.tomador),
        el(`${T}:InscricaoMunicipal`, args.tomador.inscricaoMunicipal),
        el(`${T}:CodigoMunicipio`, args.codigoMunicipio),
        el(`${T}:CodigoCancelamento`, args.codigoCancelamento),
      ]),
    ],
  });
}

interface Periodo {
  inicial: string;
  final?: string;
}

function periodo(tag: string, valores: Periodo): string {
  return grupoObrigatorio(tag, [
    el(`${T}:DataInicial`, valores.inicial),
    el(`${T}:DataFinal`, valores.final),
  ]);
}

export function consultarServicoCompradoPorNumeroEnvio(args: {
  tomador: Identificacao;
  numeroDeclarado?: number | string;
  serieDeclarada?: string;
  periodoCompetencia: Periodo;
  periodoEmissao: Periodo;
}): string {
  return documento({
    raiz: "ConsultarServicoCompradoPorNumeroEnvio",
    xmlns: namespaceDe("consultar-nota-servico-comprado-envio"),
    prefixos,
    corpo: [
      identificacao("Tomador", args.tomador),
      el("NumeroDeclarado", args.numeroDeclarado),
      el("SerieDeclarada", args.serieDeclarada),
      periodo("PeriodoCompetencia", args.periodoCompetencia),
      periodo("PeriodoEmissao", args.periodoEmissao),
    ],
  });
}

export function consultarServicoCompradoPorLoteEnvio(args: {
  tomador: Identificacao;
  protocolo: string;
}): string {
  return documento({
    raiz: "ConsultarServicoCompradoPorLoteEnvio",
    xmlns: namespaceDe("consultar-lote-nota-servico-comprado-envio"),
    prefixos,
    corpo: [identificacao("Tomador", args.tomador), el("Protocolo", args.protocolo)],
  });
}

export function consultarServicoCompradoPorProtocoloEnvio(args: {
  tomador: Identificacao;
  protocolo: string;
}): string {
  return documento({
    raiz: "ConsultarServicoCompradoPorProtocoloEnvio",
    xmlns: namespaceDe("consultar-protocolo-nota-servico-comprado-envio"),
    prefixos,
    corpo: [identificacao("Tomador", args.tomador), el("Protocolo", args.protocolo)],
  });
}
