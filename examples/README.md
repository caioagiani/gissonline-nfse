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

**Nothing here issues, cancels or changes an invoice.** `03-issuing.mjs` builds
and signs an RPS but only previews it; its single call to `issueRps` replays an
RPS that already became invoice 573, precisely to show that repeating does not
issue a second one.

## Running from inside this repository

`package.json` declares `name` and `exports`, so Node's self-referencing kicks
in: a file inside the repo importing `"gissonline-nfse"` resolves to the local
`dist/`, **not** to the installed package. Run `npm run build` first, or a stale
`dist/` will quietly run instead of your changes — which is exactly what
happened while writing these, and it looked like a missing validation rather
than an old build.

From outside the repo, in a project that installed the package, the same files
run unchanged.

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
