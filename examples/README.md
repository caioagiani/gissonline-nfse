# Examples

Runnable against the live service. Every one of these was executed against
production before being committed — the output in the comments is real.

```bash
node --env-file=.env examples/01-queries.mjs
```

| | What it shows | Writes anything? |
| --- | --- | --- |
| [01-queries.mjs](01-queries.mjs) | Period, single invoice, number range, by RPS, pagination | no |
| [02-documents.mjs](02-documents.mjs) | PDF and XML of an issued invoice | writes two local files |
| [03-issuing.mjs](03-issuing.mjs) | Assembling, signing, validating, and idempotency | **no** — see below |
| [04-multi-company.mjs](04-multi-company.mjs) | Several companies and cities in one process | no |
| [05-directory.mjs](05-directory.mjs) | Portal directory, CNPJ and postal code lookups | no |
| [06-issuing-for-many.mjs](06-issuing-for-many.mjs) | Issuing for several companies, the way an application would | no — `DRY_RUN` on |

**Nothing here issues, cancels or changes an invoice.** `03-issuing.mjs` builds
and signs an RPS but only previews it; its single call to `issueRps` replays an
RPS that already became invoice 573, precisely to show that repeating does not
issue a second one. `06-issuing-for-many.mjs` ships with `DRY_RUN = true`.

## Configuration

Every example passes the configuration in full, because that is what an
application does:

```js
const giss = new GissClient({
  environment: "producao",
  city: "suzano",                                   // the IBGE code follows from it
  cnpj: process.env.GISS_CNPJ,
  municipalRegistration: process.env.GISS_ISC_MUNICIPAL,
  certificate: readFileSync(process.env.CERT_PATH), // the .pfx in memory
  certificatePassword: process.env.CERT_PASSWORD,
});
```

Nothing is read from the environment underneath — the values come from `.env`
here only so the examples run. In a real application they come from the
company's row, and the `.pfx` is decrypted from its column into memory, never
written to disk. With a certificate already loaded through `loadCertificate`,
`certificatePassword` is not needed either: it only ever existed to open the
file.

`new GissClient()` with no arguments also works — it reads `process.env`, and
it is `--env-file` that fills that in, not the package. The library never reads
a file on its own; only the `giss` CLI does, through `process.loadEnvFile()`.
It is convenient for a terminal and wrong for a server, so no example uses it.

There is no login and no token in any of this: identity **is** the A1
certificate, presented in the TLS handshake of every call — the service answers
`400 No required SSL certificate was sent` without it, and `GISS_CNPJ`
authenticates nothing, it only fills the provider field inside the XML. The one
exception is the portal REST API (`PortalService`), which does log in with
CPF/password for the directory and the PDF/XML downloads.

## Running from inside this repository

`package.json` declares `name` and `exports`, so Node's self-referencing kicks
in: a file inside the repo importing `"gissonline-nfse"` resolves to the local
`dist/`, **not** to the installed package. Run `npm run build` first, or a stale
`dist/` will quietly run instead of your changes — which is exactly what
happened while writing these, and it looked like a missing validation rather
than an old build.

From outside the repo, in a project that installed the package, the same files
run unchanged.

## Reaching the operations

`nfse` and `nfsc` are the two published Web Services — services provided and
services received — each with its own endpoint and XML namespace, so the
namespace carries information rather than just grouping. Destructuring the
service works:

```js
const { nfse, nfsc } = giss;
await nfse.queryProvidedServices({ … });
```

Destructuring the method does not: the methods reach the certificate and the
host through `this`. For a loose reference, bind it explicitly —
`giss.nfse.queryProvidedServices.bind(giss.nfse)`.

The methods live on the prototype, which is what keeps a client at ~1.5 KB —
500 of them fit in 0.7 MB. Auto-binding every method would give each instance
its own 18 functions, which matters when you build one client per company.

## What actually answers

Checked against production on 2026-08-18:

| Method | |
| --- | --- |
| `nfse.queryProvidedServices` | ✓ |
| `nfse.queryNfseRange` | ✓ |
| `nfse.queryNfseByRps` / `findByRps` | ✓ |
| `nfse.queryRpsBatch` | ✓ |
| `nfsc.queryPurchasedByProtocol` | ✓ answers "Remessa não encontrada" for an unknown protocol |
| `nfsc.queryPurchasedByBatch` | ✓ same |
| `nfsc.queryPurchasedByNumber` | ✓ answers "Nota não encontrada" — needs `declaredNumber` and `declaredSeries` |
| `nfse.queryTakenServices` | ✗ `A01` regardless of the payload |

`queryTakenServices` is the one query that never worked; see
[../docs/gotchas.md](../docs/gotchas.md).
