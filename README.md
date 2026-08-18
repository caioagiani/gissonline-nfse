# gissonline-nfse

Node/TypeScript client for the **GissOnline** Web Services — Brazilian municipal service
invoices (NFS-e) following the ABRASF 2.04 standard with the LC 214/2025 extensions
(NT SE/CGNFS-e nº 007). Configured for Suzano/SP, but the city is an environment variable.

Covers all **16 operations** of the two published SOAP services — `nfse` (services provided)
and `nfsc` (services received) — plus the portal REST API, the only way to manage the
customer and supplier directory.

- Issue, cancel and replace invoices, single or in batches
- Queries by period, competence, number range, RPS and protocol
- Declaration of received services (supplier invoices)
- XMLDSig signing with an A1 certificate, in the shape each operation requires
- Validation against the official XSD before sending
- No write operation fires without `--confirm`

## Requirements

- Node 20+ to use the published package; 24+ to run from the repository without a build,
  since `.ts` files execute natively
- A1 ICP-Brasil digital certificate (`.pfx`) for the provider
- `xmllint` (optional) — enables XSD validation before sending

### As a package

```bash
npm install gissonline-nfse        # in a project
npm install -g gissonline-nfse     # or globally, for the giss command
```

The `giss` binary becomes available in the shell and loads the `.env` from the current
directory:

```bash
giss latest
giss issue --customer acme --amount 1500 --description "..." --confirm
```

Shell completion — **bash**:

```bash
source "$(npm root -g)/gissonline-nfse/completions/giss.bash"
# or copy it to /usr/local/etc/bash_completion.d/
```

**zsh**:

```bash
mkdir -p ~/.zsh/completions
cp "$(npm root -g)/gissonline-nfse/completions/_giss" ~/.zsh/completions/
# in ~/.zshrc, before `compinit`:
#   fpath=(~/.zsh/completions $fpath)
```

With oh-my-zsh, `~/.oh-my-zsh/completions` is already on `fpath` — copy `_giss`
there and restart the shell.

### From the repository

```bash
npm install
cp .env.example .env                    # fill in the credentials
cp /path/to/certificate.pfx cert/       # the folder ships empty
npm run giss -- latest                  # same as `giss latest`
```

Scripts: `npm run build` (compiles to `dist/`), `npm run typecheck`, `npm run giss`.

`cert/` and `data/` are versioned empty (just a `.gitkeep`) to mark where the files go —
their contents never enter the repository.

## Architecture

Layered, with dependencies always pointing inwards — `domain` knows nobody, `cli` knows
everyone:

```
src/
  domain/              rules and contracts, no I/O
    types.ts             Rps, Service, Amounts, ServiceTaker, Supplier…
    errors.ts            GissError, SoapFaultError, PortalError
    signature-policy.ts  Strategy: where the signature goes per operation
  infra/               I/O and technical detail
    certificate.ts       .pfx → PEM (node-forge) and export
    xml-signer.ts        XMLDSig c14n + rsa-sha1
    soap-client.ts       SOAP 1.1 envelope and mTLS transport
    http-client.ts       JSON HTTP for the REST API
    xml.ts               XML builders
  messages/            serialisation — Builder
    provided-services.ts XML for the nfse service
    taken-services.ts    XML for the nfsc service
    parser.ts            responses → objects
  services/            use cases
    nfse-service.ts      10 services-provided operations
    nfsc-service.ts      6 services-received operations
    portal-service.ts    directory via REST API
    giss-client.ts       facade composing the services
  storage/             local persistence — Repository
    contact-repository.ts  customers and suppliers
    profile-repository.ts  tax profile + RPS assembly
    invoice-sync.ts        derives parties from invoices
  validation/          XSD validation (xmllint)
  config/              environment, endpoints and credentials
  cli/                 command line interface
  index.ts             public API
docs/                  manuals, XSD schemas, samples and the error table
```

**Patterns applied**, each solving a concrete problem that came up:

| Pattern | Where | Why |
| --- | --- | --- |
| **Strategy** | `domain/signature-policy.ts` | The signature changes per operation — root, inner element, one per RPS plus the batch, or none at all. As a strategy each rule is named and isolated instead of becoming a conditional in the client. |
| **Builder** | `messages/` | The XSD demand an exact element order; composed `element`/`group` calls make that order explicit and checkable against the schema. |
| **Repository** | `storage/` | Local directory and tax profile behind an interface. |
| **Facade** | `services/giss-client.ts` | Loads the certificate, builds the signer and hands over ready `nfse`/`nfsc` services. |
| **Adapter** | `infra/soap-client.ts`, `http-client.ts` | Isolates SOAP and REST; services know neither `https` nor `fetch`. |

**Naming:** identifiers in English, with the standard's acronyms and entities preserved
(`Rps`, `Nfse`, `Iss`, `Cnpj`) so the code stays mappable line by line against the
official manuals and XSD.

## Configuration (`.env`)

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

## Usage

```bash
giss                                      # help with every command
giss cert [--export]                      # certificate; --export writes the PEM files

# queries — services provided
giss latest [--limit 10] [--months 12]    # most recent invoices
giss issued --from 2026-07-01 --to 2026-07-31 [--competence] [--all]
giss range --first 555 --last 569
giss rps --number 12 --series A
giss batch --protocol 202607000123

# queries — services received
giss received --from 2026-07-01 --to 2026-07-31
giss purchased-batch --protocol P
giss purchased-protocol --protocol P
giss purchased-number --from D --to D --number N --series S

# issuing (nothing is sent without --confirm)
giss issue --customer acme --amount 15000 --description "Software development"
giss issue --customer acme --amount 15000 --rps 12 --confirm
giss cancel --number 569 --reason 1 --confirm
giss replace --number 569 --reason 1 --customer acme --amount 15000 --confirm

# documents of an issued invoice
giss pdf --number 573                     # writes ./nfse-573.pdf
giss xml --number 573 --out ~/notas       # writes ~/notas/nfse-573.xml

# local directory
giss customers --sync --from 2026-01-01 --to 2026-12-31
giss suppliers
giss customer-add --tax-id 00000000000191 --name "Acme Ltda" --alias acme
giss profile [--save]

# portal directory (REST API)
giss portal-list [--type 2]
giss portal-add --tax-id ... --name ... --street ... --confirm
giss portal-import
```

Global flags: `--env producao|homologacao`, `--json`, `--xml`, `--debug`.

As a library:

```ts
import { writeFile } from "node:fs/promises";
import {
  GissClient,
  ContactRepository,
  ProfileRepository,
  PortalService,
  buildRps,
  loadPortalCredentials,
} from "gissonline-nfse";

const giss = new GissClient();

// query
const { invoices } = await giss.nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});

// automatic pagination
for await (const page of giss.paginate((page) =>
  giss.nfse.queryProvidedServices({ issuePeriod: { from, to }, page }),
)) {
  console.log(page.invoices.length);
}

// issuing
const taker = ContactRepository.asServiceTaker(
  new ContactRepository().find("customer", "acme")!,
);
const rps = buildRps(new ProfileRepository().load(), {
  taker,
  serviceAmount: 1500,
  description: "Software development",
});

giss.nfse.previewIssueNfse(rps);   // signed XML, not sent
await giss.nfse.sendRpsBatch({ batchNumber: 1, rps: [rps] });

// documents — through the portal, the Web Service issues no files
const portal = await PortalService.authenticate(loadPortalCredentials(giss.config));
const [invoice] = (await giss.nfse.queryProvidedServices({ nfseNumber: "573" })).invoices;
await writeFile("nfse-573.pdf", await portal.invoiceDocument(invoice.internalId!));
await writeFile("nfse-573.xml", await portal.invoiceDocument(invoice.internalId!, "xml"));
```

## Operations

| Service | Operation | Method |
| --- | --- | --- |
| nfse | ConsultarNfseServicoPrestado | `nfse.queryProvidedServices` |
| nfse | ConsultarNfsePorFaixa | `nfse.queryNfseRange` |
| nfse | ConsultarNfsePorRps | `nfse.queryNfseByRps` |
| nfse | ConsultarLoteRps | `nfse.queryRpsBatch` |
| nfse | ConsultarNfseServicoTomado | `nfse.queryTakenServices` |
| nfse | GerarNfse | `nfse.issueNfse` |
| nfse | RecepcionarLoteRps | `nfse.sendRpsBatch` |
| nfse | RecepcionarLoteRpsSincrono | `nfse.sendRpsBatchSync` |
| nfse | CancelarNfse | `nfse.cancelNfse` |
| nfse | SubstituirNfse | `nfse.replaceNfse` |
| nfsc | EmitirNotaServicoComprado | `nfsc.issuePurchasedService` |
| nfsc | EnviarLoteNotaServicoComprado | `nfsc.sendPurchasedServiceBatch` |
| nfsc | CancelarNotaServicoComprado | `nfsc.cancelPurchasedService` |
| nfsc | ConsultarServicoCompradoPorLote | `nfsc.queryPurchasedByBatch` |
| nfsc | ConsultarServicoCompradoPorProtocolo | `nfsc.queryPurchasedByProtocol` |
| nfsc | ConsultarServicoCompradoPorNumero | `nfsc.queryPurchasedByNumber` |

## Issuing: only the async batch works

`GerarNfse` and `RecepcionarLoteRpsSincrono` answer `A01 — Não foi possível atender a
solicitação` **even with a correct XML** — the very payload the async batch accepts and
turns into an invoice. Confirmed after every field was right: only `RecepcionarLoteRps`
issues.

That is why `issue` sends through the batch, generates the RPS number, waits for
processing and prints the invoice — the command still looks synchronous.

The batch is also the diagnostic tool: it returns the real error when you query the
protocol, while the synchronous call flattens everything into `A01`:

| Error | Field |
| --- | --- |
| `E383` | `CodigoPais` missing |
| `E310` | `MunicipioIncidencia` missing or wrong |
| `E163` | `Aliquota` missing — required under Simples Nacional |
| `E165` | `Aliquota` in the wrong format |

**The rate goes as a fraction**: 3.07% is sent as `0.0307`. Sending `3.07` means 307% and
the service rejects it with `E165`. The query, in turn, returns the percentage (`3.07`) —
it is easy to copy the value from a response and get the request wrong. The builder does
the conversion: the API takes percentages.

## How the integration works

1. **mTLS** — the WSDL and the endpoint only answer with an ICP-Brasil client certificate
   in the handshake (without it: `400 No required SSL certificate was sent`). The `.pfx` is
   converted to PEM in memory with `node-forge`, because Node's OpenSSL rejects the legacy
   ciphers Brazilian CAs use (`Unsupported PKCS12 PFX data`). To debug outside the app:

   ```bash
   giss cert --export
   curl --cert cert/cert.pem --key cert/key.pem "https://ws-suzano.giss.com.br/service-ws/nf/nfse-ws?wsdl"
   ```

   The OpenSSL equivalent needs the `legacy` provider:

   ```bash
   openssl pkcs12 -legacy -in cert/*.pfx -clcerts -nokeys -out cert/cert.pem
   openssl pkcs12 -legacy -in cert/*.pfx -nocerts -nodes  -out cert/key.pem
   ```

2. **SOAP 1.1 envelope** — `document/literal wrapped`. The `nfse` service takes
   `nfseCabecMsg` + `nfseDadosMsg`; `nfsc` takes only `nfscDadosMsg`, with no version
   header, and uses a different namespace (`http://nfsc.eicon.com.br`).

3. **XMLDSig signature** — c14n `REC-xml-c14n-20010315` + `rsa-sha1` + `sha1` digest,
   enveloped, `KeyInfo` carrying only `X509Certificate`. Where it goes changes per
   operation:

   | Operation | Signature |
   | --- | --- |
   | Services-provided queries | root, `URI=""` |
   | `ConsultarNfseServicoTomado` | **none** — the XSD declares no `Signature` |
   | `GerarNfse` | inside `Rps`, `URI="#<InfDeclaracaoPrestacaoServico Id>"` |
   | `CancelarNfse` | inside `Pedido`, `URI="#<InfPedidoCancelamento Id>"` |
   | RPS batches | one per RPS plus the batch, `URI="#<LoteRps Id>"` |
   | `SubstituirNfse` | RPS + request + root, `URI="#<SubstituicaoNfse Id>"` |
   | `nfsc` operations | root, `URI=""` |

4. **Namespaces** are GissOnline's, not ABRASF's:
   `http://www.giss.com.br/<schema>-v2_04.xsd`, with complex types under
   `.../tipos-v2_04.xsd`. Services received use `v1_00`.

## Directory of customers and suppliers

The **SOAP Web Service has no directory** — the list published at `/service-ws/` holds only
the 16 invoice operations, and under ABRASF the party data travels inside each invoice.

The directory you see in the portal (*Manutenção Cadastral → Clientes e Fornecedores*) runs
on a **separate REST API**, implemented in `src/services/portal-service.ts`:

```bash
giss portal-list                  # customers registered in the portal
giss portal-list --type 2         # suppliers
giss portal-add --tax-id ... --name ... --confirm
giss portal-import                # brings the portal directory into the local one
```

| | SOAP (`/service-ws/`) | REST (`service-empresa/api/`) |
| --- | --- | --- |
| Authentication | A1 certificate (mTLS) | JWT from CPF/password login |
| Base | `https://ws-<city>.giss.com.br` | `https://<IBGE code>.giss.com.br` |
| Party directory | does not exist | `cliente-fornecedor/` (CRUD) |
| Invoice issuing | yes | — |

The REST login takes three steps: `POST login/token` with `grant_type=password`, then
`GET login/permissao` to list the linked companies, then `POST login/token` with
`grant_type=refresh_token` and the `PARAM_LOGIN`, `CODIGO_USUARIO` and
`PARAM_PRIV: empresa=<id>` headers.

**It is an internal API with no public contract — it can change without notice.**

Two of its rules cost a debugging round each: contact fields are **objects**, not
strings (`email: {email}`, `telefone: {codigoArea, telefone}`) — plain strings
answer HTTP 500; and an update only persists when `alterado` is true, otherwise
the `PUT` answers 200 and silently changes nothing.

## Documents (PDF and XML)

Neither Web Service produces a file: ABRASF only returns the invoice as XML embedded
in the SOAP response, and the printed representation is the portal's job — `pdf`,
`danfe` and `imprimir` appear nowhere in the two WSDLs. So `giss pdf` and `giss xml`
go through the portal REST API:

```bash
giss pdf --number 573                  # ./nfse-573.pdf
giss xml --number 573                  # ./nfse-573.xml
giss pdf --number 573 --out ~/notas    # a directory, or a full path ending in .pdf
```

Both resolve the invoice by its printed number, then download by the **internal id** —
the `Id` attribute of `InfNfse`, which the portal route needs and the printed number
cannot replace. That is why the commands query the invoice first.

The XML is the same `CompNfse` the query returns, but standalone: namespaces declared
on the element itself instead of inherited from the SOAP envelope, so the file is valid
on its own. Neither copy is signed — the Suzano service does not sign the invoices it
stores. If the SOAP copy is enough for you, `--xml` on any query prints the envelope
and needs no portal login.
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

## Lookups

Neither GissOnline service resolves a CNPJ, so filling a party means copying from
the Receita's site. `giss zip` and `giss cnpj` close that gap through
[BrasilAPI](https://brasilapi.com.br):

```bash
giss zip 04744-010
giss cnpj 60977243000106
giss customer-add --tax-id 60977243000106 --lookup   # fills the blanks
```

`--lookup` works on `customer-add` and `portal-add`, and anything passed
explicitly wins over the lookup. BrasilAPI is a free community service with no
SLA — treat the result as a starting point to check, never as a source of truth,
and note that it rejects requests without an identifying `User-Agent`.

For issuing via Web Service the portal directory is not even needed: party data travels
inside the invoice, taken from the local directory.

## Gotchas

All found by testing against the live service:

- **Signing the whole batch is not enough.** The manual says the batch signature waives the
  individual ones, but the service answers `E174 — RPS não assinado`. Each RPS must be
  signed, and the batch signature must reference the `LoteRps` Id — with `URI=""` it
  invalidates the RPS signatures and `E174` comes back.
- **Signing where the XSD declares no `Signature` breaks the request** with `E160`. That is
  the case for `ConsultarNfseServicoTomado`.
- **Request format ≠ response format.** Queries return `ItemListaServico` as `1.04` while
  the request needs `01.04`; `CodigoNbs` comes back as `1.1703.10.00` and goes as
  `117031000` (9 chars max); `finNFSe` comes back `1` and only accepts `0`;
  `cLocalidadeIncid` comes back `1` and must be sent as the 7-digit IBGE code.
- **The ISS rate goes as a fraction**, as described above.
- **`ConsultarServicoCompradoPorNumero` requires the declared number and series**, although
  the XSD marks them optional — without them the server answers HTTP 400.
- **The `nfsc` service double-encodes its text** ("Nota nÃ£o encontrada"); the client
  detects and fixes it.
- **`tipos-servicos-comprados-v1_01.xsd` is an incomplete delta** (54 types against 191 in
  v1_00) and does not compile on its own, despite sharing the `targetNamespace`. See
  `docs/schemas-tomados/vigente/`.
- **Beware of `toISOString` on competence dates**: at night in São Paulo it rolls the day
  forward and changes the invoice's competence.

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

## Tax profile

`src/storage/profile-repository.ts` holds the values repeated on every issue (LC 116 item,
CNAE, NBS, city, ISS taxability, PIS/COFINS, IBS/CBS). The defaults come from a real
invoice already accepted by the city hall, with the formats corrected for sending.
`giss profile --save` writes them to `data/profile.json` for editing.

**Check them with your accountant before issuing** — the defaults describe a Simples
Nacional provider, ISS not withheld, service item 01.04.

## Security

Never committed (already covered by `.gitignore`):

- `.env` — certificate password and portal credentials
- `cert/*` — the `.pfx` and exported PEM files (the key is written **without a passphrase**,
  mode `0600`)
- `data/*` — local directory and tax profile, holding third-party data

Two notes on the code: the `APP_ID` in `portal-service.ts` is not a secret — it is a public
constant from the portal bundle, sent by any browser that opens the site. And the signature
uses `rsa-sha1` with a `sha1` digest: weak by today's standards, but it is what the service
validates (manual, section 6.3).

## Documentation

Under `docs/`: technical manuals (Services Provided v1.6, Services Received/CST v2.5,
PIS/COFINS/CSLL v1.0), XSD schemas, XML samples and the errors and alerts spreadsheet.
Source: <https://suzano.giss.com.br/giss-ajuda/desenvolvedores.html>.

`docs/schemas-tomados/vigente/` carries the services-received XSD with the `tipos` v1_01
merged over v1_00 — necessary because the published v1_01 is a delta that does not compile
on its own. The originals stay untouched in the directory above.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by a
local hook and a CI check. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releasing

Fully automatic. Merging a pull request into `main` is the whole ritual:
[semantic-release](https://semantic-release.gitbook.io) reads the conventional
commits, works out the version, writes the changelog, tags, opens the GitHub
release, and publishes to npm through
[trusted publishing](https://docs.npmjs.com/trusted-publishers) — OIDC, no token
stored anywhere.

| Commit | Release |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `chore:`, `ci:`, `docs:`, `test:` | none |

Which is why the commit type matters: it is the only input to the version. A
`fix` labelled as `chore` never ships.

## Disclaimer

Independent project, not affiliated with Eicon or GissOnline. The portal REST API is
internal and has no public contract — it may change without notice. Issuing, cancelling or
replacing an invoice has real tax effects: check the profile values with your accountant
before using `--confirm` in production.

## License

MIT
