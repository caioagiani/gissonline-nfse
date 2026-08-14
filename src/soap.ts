import { request } from "node:https";
import type { Certificado } from "./cert.ts";
import { desescaparXml, escaparXml } from "./xml.ts";

/** Serviços SOAP publicados em `/service-ws/`. */
export const SERVICOS = {
  /** NFS-e — serviços prestados */
  nfse: {
    caminho: "/service-ws/nf/nfse-ws",
    namespace: "http://nfse.abrasf.org.br",
    /** Envia cabeçalho de versão junto com os dados */
    comCabecalho: true,
    parametroDados: "nfseDadosMsg",
  },
  /** NFSC — notas de serviço comprado (serviços tomados) */
  nfsc: {
    caminho: "/service-ws/nf/nfsc-ws",
    namespace: "http://nfsc.eicon.com.br",
    comCabecalho: false,
    parametroDados: "nfscDadosMsg",
  },
} as const;

export type Servico = keyof typeof SERVICOS;

export type OperacaoNfse =
  | "CancelarNfse"
  | "ConsultarLoteRps"
  | "ConsultarNfsePorFaixa"
  | "ConsultarNfsePorRps"
  | "ConsultarNfseServicoPrestado"
  | "ConsultarNfseServicoTomado"
  | "GerarNfse"
  | "RecepcionarLoteRps"
  | "RecepcionarLoteRpsSincrono"
  | "SubstituirNfse";

export type OperacaoNfsc =
  | "CancelarNotaServicoComprado"
  | "ConsultarServicoCompradoPorLote"
  | "ConsultarServicoCompradoPorNumero"
  | "ConsultarServicoCompradoPorProtocolo"
  | "EmitirNotaServicoComprado"
  | "EnviarLoteNotaServicoComprado";

export type Operacao = OperacaoNfse | OperacaoNfsc;

export interface RespostaSoap {
  /** XML de negócio já desembrulhado do envelope SOAP e desescapado */
  xml: string;
  envelope: string;
  status: number;
}

export function montarEnvelope(
  servico: Servico,
  operacao: Operacao,
  dados: string,
  cabecalho?: string,
): string {
  const { namespace, parametroDados } = SERVICOS[servico];
  const cabecalhoXml = cabecalho
    ? `<nfseCabecMsg>${escaparXml(cabecalho)}</nfseCabecMsg>`
    : "";
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${namespace}">` +
    "<soapenv:Header/><soapenv:Body>" +
    `<ws:${operacao}Request>` +
    cabecalhoXml +
    `<${parametroDados}>${escaparXml(dados)}</${parametroDados}>` +
    `</ws:${operacao}Request>` +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

export interface OpcoesChamada {
  /** Host base, ex.: `https://ws-suzano.giss.com.br` */
  host: string;
  servico: Servico;
  certificado: Certificado;
  cabecalho?: string;
  timeoutMs?: number;
}

/** Envia a mensagem SOAP ao Web Service usando mTLS com o certificado A1. */
export async function chamar(
  operacao: Operacao,
  dados: string,
  { host, servico, certificado, cabecalho, timeoutMs = 60_000 }: OpcoesChamada,
): Promise<RespostaSoap> {
  const definicao = SERVICOS[servico];
  const corpo = montarEnvelope(servico, operacao, dados, cabecalho);
  const url = new URL(definicao.caminho, host);

  const resposta = await new Promise<{ body: string; status: number }>(
    (resolvido, rejeitado) => {
      const req = request(
        {
          host: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: "POST",
          // PEM em vez do .pfx: os PKCS#12 da ICP-Brasil usam cifras legadas
          // que o OpenSSL do Node recusa ("Unsupported PKCS12 PFX data").
          key: certificado.chavePrivadaPem,
          cert: [certificado.certificadoPem, ...certificado.cadeiaPem].join(""),
          minVersion: "TLSv1.2",
          headers: {
            "Content-Type": "text/xml;charset=UTF-8",
            SOAPAction: `"${definicao.namespace}/${operacao}"`,
            "Content-Length": Buffer.byteLength(corpo),
          },
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (parte: Buffer) => partes.push(parte));
          res.on("end", () =>
            resolvido({
              body: Buffer.concat(partes).toString("utf8"),
              status: res.statusCode ?? 0,
            }),
          );
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout de ${timeoutMs}ms em ${operacao}`));
      });
      req.on("error", rejeitado);
      req.end(corpo);
    },
  );

  return {
    status: resposta.status,
    envelope: resposta.body,
    xml: extrairOutputXml(resposta.body, operacao),
  };
}

/**
 * O serviço `nfsc` devolve as mensagens em UTF-8 codificado duas vezes
 * ("Nota nÃ£o encontrada"). Quando o padrão aparece, refaz a decodificação.
 */
function corrigirCodificacao(texto: string): string {
  if (!/[ÃÂ][-¿]/.test(texto)) return texto;
  const corrigido = Buffer.from(texto, "latin1").toString("utf8");
  return corrigido.includes("�") ? texto : corrigido;
}

function extrairOutputXml(envelope: string, operacao: Operacao): string {
  const conteudo = /<(?:\w+:)?outputXML>([\s\S]*?)<\/(?:\w+:)?outputXML>/.exec(
    envelope,
  );
  if (conteudo?.[1]) return corrigirCodificacao(desescaparXml(conteudo[1]));

  const falha = /<(?:\w+:)?faultstring>([\s\S]*?)<\/(?:\w+:)?faultstring>/.exec(
    envelope,
  );
  if (falha?.[1]) {
    throw new Error(`SOAP Fault em ${operacao}: ${desescaparXml(falha[1])}`);
  }

  throw new Error(
    `Resposta inesperada em ${operacao}: ${envelope.slice(0, 500)}`,
  );
}
