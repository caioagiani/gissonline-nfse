import { request } from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Certificate } from "../../infra/certificate.ts";
import {
  assertCertificateUsable,
  classifyTransportError,
  timeoutError,
} from "../../infra/transport-errors.ts";

/**
 * Transporte da API do Sistema Nacional NFS-e (SEFIN e ADN).
 *
 * Diferente do SOAP do GissOnline, é REST com JSON — mas os documentos
 * continuam XML, viajando compactados com gzip e em base64 dentro do JSON.
 * A autenticação é a mesma: mTLS com o A1 do contribuinte, sem token.
 */
export interface NationalResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

export interface NationalRequest {
  certificate: Certificate;
  method?: "GET" | "POST" | "HEAD";
  json?: unknown;
  timeoutMs?: number;
}

export async function callNational(
  url: string,
  { certificate, method = "GET", json, timeoutMs = 60_000 }: NationalRequest,
): Promise<NationalResponse> {
  const payload = json === undefined ? undefined : JSON.stringify(json);
  const context = {
    provider: "nacional" as const,
    operation: `${method} ${new URL(url).pathname}`,
    write: method === "POST",
  };
  assertCertificateUsable(certificate, context);

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        // PEM em vez do .pfx, pelo mesmo motivo do cliente SOAP.
        key: certificate.privateKeyPem,
        cert: [certificate.certificatePem, ...certificate.chainPem].join(""),
        minVersion: "TLSv1.2",
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(timeoutError(timeoutMs));
    });
    req.on("error", (error) => reject(classifyTransportError(error, context)));
    req.end(payload);
  });
}

/** XML → gzip → base64, o formato dos campos `*XmlGZipB64`. */
export const packXml = (xml: string): string =>
  gzipSync(Buffer.from(xml, "utf8")).toString("base64");

export const unpackXml = (packed: string): string =>
  gunzipSync(Buffer.from(packed, "base64")).toString("utf8");

/** Corpo JSON da resposta, ou `null` quando ela não é JSON (HTML de erro do IIS). */
export function parseJson<T>(response: NationalResponse): T | null {
  try {
    return JSON.parse(response.body.toString("utf8")) as T;
  } catch {
    return null;
  }
}
