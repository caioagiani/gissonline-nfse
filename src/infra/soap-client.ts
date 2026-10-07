import { request } from "node:https";
import { NfseError } from "../domain/errors.ts";
import {
  assertCertificateUsable,
  classifyTransportError,
  timeoutError,
} from "./transport-errors.ts";
import { SoapFaultError } from "../domain/errors.ts";
import type { Certificate } from "./certificate.ts";
import { escapeXml, unescapeXml } from "./xml.ts";

/** Serviços SOAP publicados em `/service-ws/`. */
export const SOAP_SERVICES = {
  /** NFS-e — serviços prestados */
  nfse: {
    path: "/service-ws/nf/nfse-ws",
    namespace: "http://nfse.abrasf.org.br",
    /** Envia cabeçalho de versão junto com os dados */
    hasHeader: true,
    dataParameter: "nfseDadosMsg",
  },
  /** NFSC — notas de serviço comprado (serviços tomados) */
  nfsc: {
    path: "/service-ws/nf/nfsc-ws",
    namespace: "http://nfsc.eicon.com.br",
    hasHeader: false,
    dataParameter: "nfscDadosMsg",
  },
} as const;

export type SoapService = keyof typeof SOAP_SERVICES;

export type NfseOperation =
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

export type NfscOperation =
  | "CancelarNotaServicoComprado"
  | "ConsultarServicoCompradoPorLote"
  | "ConsultarServicoCompradoPorNumero"
  | "ConsultarServicoCompradoPorProtocolo"
  | "EmitirNotaServicoComprado"
  | "EnviarLoteNotaServicoComprado";

export type SoapOperation = NfseOperation | NfscOperation;

/** Operações que alteram estado: uma falha depois do envio deixa o resultado incerto. */
const WRITE_OPERATIONS = new Set<SoapOperation>([
  "CancelarNfse",
  "GerarNfse",
  "RecepcionarLoteRps",
  "RecepcionarLoteRpsSincrono",
  "SubstituirNfse",
  "CancelarNotaServicoComprado",
  "EmitirNotaServicoComprado",
  "EnviarLoteNotaServicoComprado",
]);

export interface SoapResponse {
  /** XML de negócio já desembrulhado do envelope SOAP e desescapado */
  xml: string;
  envelope: string;
  status: number;
}

export function buildEnvelope(
  service: SoapService,
  operation: SoapOperation,
  data: string,
  header?: string,
): string {
  const { namespace, dataParameter } = SOAP_SERVICES[service];
  const headerXml = header
    ? `<nfseCabecMsg>${escapeXml(header)}</nfseCabecMsg>`
    : "";
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${namespace}">` +
    "<soapenv:Header/><soapenv:Body>" +
    `<ws:${operation}Request>` +
    headerXml +
    `<${dataParameter}>${escapeXml(data)}</${dataParameter}>` +
    `</ws:${operation}Request>` +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

export interface SoapCallOptions {
  /** Host base, ex.: `https://ws-suzano.giss.com.br` */
  host: string;
  service: SoapService;
  certificate: Certificate;
  header?: string;
  timeoutMs?: number;
}

/** Envia a mensagem SOAP ao Web Service usando mTLS com o certificado A1. */
export async function callSoap(
  operation: SoapOperation,
  data: string,
  { host, service, certificate, header, timeoutMs = 60_000 }: SoapCallOptions,
): Promise<SoapResponse> {
  const definition = SOAP_SERVICES[service];
  const payload = buildEnvelope(service, operation, data, header);
  const url = new URL(definition.path, host);
  const context = {
    provider: "giss" as const,
    operation,
    write: WRITE_OPERATIONS.has(operation),
  };
  assertCertificateUsable(certificate, context);

  const response = await new Promise<{ body: string; status: number }>(
    (resolve, reject) => {
      const req = request(
        {
          host: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: "POST",
          // PEM em vez do .pfx: os PKCS#12 da ICP-Brasil usam cifras legadas
          // que o OpenSSL do Node recusa ("Unsupported PKCS12 PFX data").
          key: certificate.privateKeyPem,
          cert: [certificate.certificatePem, ...certificate.chainPem].join(""),
          minVersion: "TLSv1.2",
          headers: {
            "Content-Type": "text/xml;charset=UTF-8",
            SOAPAction: `"${definition.namespace}/${operation}"`,
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              status: res.statusCode ?? 0,
            }),
          );
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(timeoutError(timeoutMs));
      });
      req.on("error", (error) => reject(classifyTransportError(error, context)));
      req.end(payload);
    },
  );

  return readSoapResponse(operation, response.status, response.body);
}

/**
 * Desembrulha a resposta. Sem XML de negócio e com 5xx, é o servidor fora do
 * ar (o balanceador devolve HTML) — não um fault, e vale tentar de novo.
 */
export function readSoapResponse(
  operation: SoapOperation,
  status: number,
  envelope: string,
): SoapResponse {
  try {
    return { status, envelope, xml: extractOutputXml(envelope, operation) };
  } catch (error) {
    if (status >= 500 && !/faultstring/.test(envelope)) {
      throw new NfseError(`${operation} (giss): serviço indisponível, HTTP ${status}`, {
        code: "UNAVAILABLE",
        provider: "giss",
        operation,
        retryable: true,
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * O serviço `nfsc` devolve as mensagens em UTF-8 codificado duas vezes
 * ("Nota nÃ£o encontrada"). Quando o padrão aparece, refaz a decodificação.
 */
function fixEncoding(text: string): string {
  if (!/[ÃÂ][-¿]/.test(text)) return text;
  const fixed = Buffer.from(text, "latin1").toString("utf8");
  return fixed.includes("�") ? text : fixed;
}

function extractOutputXml(envelope: string, operation: SoapOperation): string {
  const content = /<(?:\w+:)?outputXML>([\s\S]*?)<\/(?:\w+:)?outputXML>/.exec(
    envelope,
  );
  if (content?.[1]) return fixEncoding(unescapeXml(content[1]));

  const fault = /<(?:\w+:)?faultstring>([\s\S]*?)<\/(?:\w+:)?faultstring>/.exec(
    envelope,
  );
  if (fault?.[1]) throw new SoapFaultError(operation, unescapeXml(fault[1]));

  throw new SoapFaultError(
    operation,
    `resposta inesperada: ${envelope.slice(0, 300)}`,
  );
}
