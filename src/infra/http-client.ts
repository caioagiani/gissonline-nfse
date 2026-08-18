import { PortalError } from "../domain/errors.ts";

/** Cliente HTTP JSON usado pela API REST do portal. */
export async function requestJson<T>(
  base: string,
  route: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(route, base), {
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) throw new PortalError(route, response.status, body);
  return body as T;
}

/**
 * Variante binária, para as rotas que devolvem um arquivo em vez de JSON.
 *
 * Um erro ainda chega como JSON — e às vezes com HTTP 200, trocando o
 * `Content-Type` por `application/json`. Por isso o corpo só é aceito depois de
 * conferir o tipo, senão o PDF salvo em disco seria uma mensagem de erro.
 */
export async function requestBinary(
  base: string,
  route: string,
  init: RequestInit,
  expected: string,
): Promise<Buffer> {
  const response = await fetch(new URL(route, base), {
    ...init,
    headers: { Accept: expected, ...init.headers },
  });

  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes(expected)) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // não era JSON; o texto cru já serve de diagnóstico
    }
    throw new PortalError(route, response.status, body);
  }

  return Buffer.from(await response.arrayBuffer());
}
