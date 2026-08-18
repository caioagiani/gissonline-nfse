# Configuration

## Environment (`.env`)

| Variable | Description |
| --- | --- |
| `GISS_ENV` | `producao` or `homologacao` |
| `GISS_MUNICIPIO` | city slug in the host (`suzano` → `ws-suzano.giss.com.br`) |
| `GISS_VERSAO` | layout version (`2.04`) |
| `GISS_CODIGO_MUNICIPIO` | IBGE code (Suzano = `3552502`) |
| `CERT_PATH` / `CERT_PASSWORD` | A1 certificate and its password |
| `GISS_CNPJ` / `GISS_ISC_MUNICIPAL` | the provider |
| `GISS_LOGIN` / `GISS_PASS` | portal login, only for the REST directory |

Every one of these has a programmatic override, so an application that serves
more than one company never needs a `.env` — see
[Serving several companies](#serving-several-companies).

## Serving several companies

Nothing in the package is global: pass the whole configuration to the constructor
and no environment variable is read. The certificate accepts a path, the `.pfx`
already in memory, or an instance you loaded earlier:

```ts
import { GissClient, loadCertificate } from "gissonline-nfse";

const pfx = await decryptStoredCertificate(tenantId);   // never touches disk

const giss = new GissClient({
  environment: "producao",
  city: "suzano",
  cityCode: "3552502",
  cnpj: tenant.cnpj,
  municipalRegistration: tenant.municipalRegistration,
  version: "2.04",
  certificate: pfx,
  certificatePassword: tenant.certificatePassword,
});
```

Accepting a `Buffer` is what keeps a customer's private key off your filesystem.
Reusing a parsed certificate is a separate concern:

```ts
const certificate = loadCertificate(pfx, password);     // parse once
for (const rps of batch) {
  const giss = new GissClient({ ...tenantConfig, certificate });
}
```

With an instance neither `CERT_PATH` nor `CERT_PASSWORD` is needed — both exist
only to open the file.

**On caching certificates across requests.** Measured here: a `Certificate` weighs
14 KB (1,000 tenants ≈ 14 MB), parsing a `.pfx` takes ~16 ms, and a SOAP
round-trip takes ~400 ms — so the parse is about **4%** of a call. Memory is not
the constraint; holding many private keys in a long-lived process is. Prefer
job-scoped reuse, as above, over a global cache. If you do cache, keep the TTL
short and include the certificate's fingerprint in the key, so replacing an
expiring A1 invalidates the entry instead of signing with the old one until a
worker restarts.

The portal credentials take overrides the same way, since each company logs in
with its own CPF:

```ts
const portal = await PortalService.authenticate(
  loadPortalCredentials(giss.config, { login: tenant.cpf, password: tenant.password }),
);
```

One caveat for a multi-company product: a CNPJ that is not registered in the
homologation environment fails every call with `E361`, so a new customer's first
invoice would go straight to production unless GissOnline registers them for
testing. That is an onboarding question to settle with the vendor, not something
the package can work around.

## Tax profile

`src/storage/profile-repository.ts` holds the values repeated on every issue (LC 116 item,
CNAE, NBS, city, ISS taxability, PIS/COFINS, IBS/CBS). The defaults come from a real
invoice already accepted by the city hall, with the formats corrected for sending.
`giss profile --save` writes them to `data/profile.json` for editing.

**Check them with your accountant before issuing** — the defaults describe a Simples
Nacional provider, ISS not withheld, service item 01.04.

## Test environment

The Services Provided manual v1.6 announces `ws-homologacao.giss.com.br`, but that host
only serves the Angular portal (`405` on POST). The SOAP environment that answers is the
one quoted in the PIS/COFINS manual:

```
https://ws-homologacao-rtc.giss.com.br/service-ws/nf/nfse-ws
```

That is what `--env homologacao` uses. Two known limits: the provider CNPJ is **not
registered** there, so operations stop at `E361 — Empresa não localizada` (which is exactly
the useful ceiling for testing schema and signature); and `tpRetPisCofins` is rejected with
`E160` even though it is in the published XSD and in real production invoices.
