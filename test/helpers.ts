import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { buildRps, DEFAULT_PROFILE, type IssueInput } from "../src/storage/profile-repository.ts";
import type { Certificate } from "../src/infra/certificate.ts";
import type { NationalRequest, NationalResponse } from "../src/providers/nacional/national-client.ts";
import type { Rps } from "../src/domain/types.ts";

let cached: Certificate | undefined;

/** Certificado autoassinado, gerado uma vez por processo — nenhum A1 real entra nos testes. */
export function testCertificate(): Certificate {
  if (cached) return cached;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01");
  cert.validity.notAfter = new Date("2027-01-01");
  const attrs = [{ name: "commonName", value: "EMPRESA TESTE:37969249000110" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);

  cached = {
    privateKeyPem,
    certificatePem,
    chainPem: [],
    certificateBase64: certificatePem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
      .replace(/\s+/g, ""),
    subject: "EMPRESA TESTE:37969249000110",
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  };
  return cached;
}

/** O mesmo certificado com outra validade — para os cenários de vencido e futuro. */
export function certificateValid(from: string, to: string): Certificate {
  return { ...testCertificate(), validFrom: new Date(from), validTo: new Date(to) };
}

/** `.pfx` de verdade, cifrado com senha, para exercitar `loadCertificate`. */
export function testPfx(password: string): Buffer {
  const certificate = testCertificate();
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    forge.pki.privateKeyFromPem(certificate.privateKeyPem),
    [forge.pki.certificateFromPem(certificate.certificatePem)],
    password,
    { algorithm: "3des" },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

export const PROVIDER_CNPJ = "37969249000110";
export const SUZANO = "3552502";

/** RPS no formato que o CLI compõe, com o perfil padrão. */
export function sampleRps(overrides: Partial<IssueInput> = {}): Rps {
  return buildRps(DEFAULT_PROFILE, {
    taker: {
      cnpj: "52.884.617/0001-10",
      legalName: "Cliente & Filhos Ltda",
      address: {
        street: "Rua das Flores",
        number: "100",
        district: "Centro",
        cityCode: SUZANO,
        state: "SP",
        zipCode: "08675-000",
      },
      contact: { email: "fin@cliente.com.br", phone: "(11) 4444-5555" },
    },
    serviceAmount: 1500,
    description: "Desenvolvimento de software",
    competenceDate: "2026-10-06",
    rate: 3.07,
    ...overrides,
  });
}

export interface RecordedCall {
  url: string;
  request: NationalRequest;
}

type Route = (call: RecordedCall) => Partial<NationalResponse> & { json?: unknown };

/**
 * Transporte falso para o `NationalService`: cada rota responde por prefixo de
 * URL (a mais longa vence), e todas as chamadas ficam registradas.
 */
export function fakeTransport(routes: Record<string, Route>) {
  const calls: RecordedCall[] = [];
  const transport = async (url: string, request: NationalRequest): Promise<NationalResponse> => {
    const call = { url, request };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Rota não prevista no teste: ${url}`);
    const { json, ...response } = routes[key]!(call);
    return {
      status: 200,
      contentType: json === undefined ? "text/plain" : "application/json",
      body: json === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(json)),
      ...response,
    };
  };
  return { transport, calls };
}
