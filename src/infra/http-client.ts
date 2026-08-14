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
