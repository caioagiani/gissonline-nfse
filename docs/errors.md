# Errors

Every error the library throws is an `NfseError`. Code that integrates it can decide
what to do from fields, never from the message text, which may change.

```ts
import { NfseError } from "nfse-br";

try {
  await client.national.issue(rps, { series: "1", number: "42", simplesOption: 3 });
} catch (error) {
  if (!(error instanceof NfseError)) throw error;

  if (error.outcomeUnknown) {
    // The request may have reached the service. Repeat with the SAME number:
    // it returns the existing invoice instead of issuing a second one.
  } else if (error.retryable) {
    // Transient: network, timeout, 5xx, 429. Back off and repeat.
  } else {
    // Needs a change: data, configuration, certificate, or the city.
  }
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `code` | stable category, in the table below |
| `provider` | `giss`, `portal`, `nacional` or `brasilapi` |
| `operation` | the SOAP operation or HTTP route that failed |
| `retryable` | repeating the same request may succeed |
| `outcomeUnknown` | a write left without an answer: it may or may not have happened |
| `details` | data for diagnosis or a safe retry: `dpsId`, `rps`, `errno`, `path`… |
| `cause` | the underlying error (Node, `fetch`, `node-forge`) |

## Codes

| `code` | When | `retryable` |
| --- | --- | --- |
| `CONFIG` | a variable is missing or invalid | no |
| `CERTIFICATE` | `.pfx` unreadable, wrong password, expired, not yet valid, or refused in the TLS handshake | no |
| `VALIDATION` | invalid input, refused before anything is sent | no |
| `NOT_SUPPORTED` | the provider does not build this yet (e.g. a foreign taker on the national issuer) | no |
| `REJECTED` | the service refused: business rule, schema, `E0039`… `messages` carries its codes | no |
| `NOT_FOUND` | the invoice or DPS does not exist | no |
| `AUTHENTICATION` | portal login or certificate refused (HTTP 401/403) | no |
| `UNAVAILABLE` | HTTP 408, 429 or 5xx, or an HTML error page instead of SOAP | yes |
| `TRANSPORT` | connection refused or reset, DNS, timeout | yes, except an untrusted server certificate |
| `UNEXPECTED_RESPONSE` | a SOAP fault, or an answer outside the documented format | no |

Classes, for `instanceof`: `ConfigError`, `CertificateError`, `ValidationError`,
`NotSupportedError` and `TransportError`. Errors that carry the service's own messages
are `GissError` and `NationalError` (both expose `messages: { code, message,
correction }[]`). The other service errors are `SoapFaultError`, `PortalError` and
`LookupError`.

## Writes and retries

Issuing and cancelling are the operations where a lost answer is dangerous. Both
providers are idempotent by number. The **RPS** number on GissOnline and the **DPS**
series and number on the national system identify the intent to issue, and the service
accepts each one only once.

- **GissOnline**: `issueRps` queries by RPS before sending. A failure while sending
  carries `details.rps`.
- **National**: `issue` checks the DPS before sending. When the send fails with no answer
  (network, timeout, 5xx), it **checks the DPS again** before giving up:
  - the invoice exists: it returns `status: "reconciled"`. It was issued; only the answer
    was lost;
  - the SEFIN confirms nothing was issued: the error comes back with
    `outcomeUnknown: false`, and repeating is safe;
  - that check fails too: `outcomeUnknown: true`, with `details.dpsId` to repeat with.

A number generated anew on every call (a timestamp, a random value) defeats all of this.
Store the number before the first attempt and reuse it.

## Certificate

The certificate is checked before every request. An expired one fails with the date
(`CERTIFICATE`), instead of a generic TLS alert from the server. The CLI warns
30 days before expiry.
