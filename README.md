# gissonline-nfse

Node/TypeScript client for the **GissOnline** Web Services — Brazilian municipal service
invoices (NFS-e) following the ABRASF 2.04 standard with the LC 214/2025 extensions
(NT SE/CGNFS-e nº 007). Works with every city that runs GissOnline — **32 of them**,
24 in São Paulo, including Guarulhos, Santos and Santo André. The city is one
environment variable; see [docs/municipalities.md](docs/municipalities.md).

Covers all **16 operations** of the two published SOAP services — `nfse` (services provided)
and `nfsc` (services received) — plus the portal REST API, the only way to reach the
customer and supplier directory and the municipal activity table.

- Issue, cancel and replace invoices, single or in batches
- Queries by period, competence, number range, RPS and protocol
- The city activity table, where `CodigoTributacaoMunicipio` and its LC 116 item come from
- Declaration of received services (supplier invoices)
- XMLDSig signing with an A1 certificate, in the shape each operation requires
- Portal login with that same certificate, so no CPF and password are needed
- Validation against the official XSD before sending
- No write operation fires without `--confirm`

## Requirements

- Node 20+ to use the published package; 24+ to run from the repository without a build,
  since `.ts` files execute natively
- A1 ICP-Brasil digital certificate (`.pfx`) for the provider
- `xmllint` (optional) — enables XSD validation before sending

## Install

### As a package

```bash
npm install gissonline-nfse        # in a project
npm install -g gissonline-nfse     # or globally, for the giss command
```

The `giss` binary becomes available in the shell and reads the `.env` of the current
directory. Shell completion for bash and zsh is described in [docs/cli.md](docs/cli.md#shell-completion).

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

## Quick start

```bash
giss latest                               # the most recent invoices
giss activities --company                 # activity codes this company can use
giss issue --customer acme --amount 1500 --description "Consulting"
giss issue --customer acme --amount 1500 --description "Consulting" --confirm
giss pdf --number 573                     # the invoice as a file
```

```ts
import { GissClient, PortalService } from "gissonline-nfse";

// `nfse` and `nfsc` are the two Web Services; `config` and `certificate` come
// resolved. Destructuring a service is safe — destructuring a method is not.
const { nfse, config, certificate } = new GissClient();

const { invoices } = await nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});

// CodigoTributacaoMunicipio and its LC 116 item, from the city's own table.
// This route is public — no login, no certificate:
const activities = await PortalService.listActivities(config.cityCode);
// [{ code: "6319400", serviceListItem: "1.09", description: "Portais…", rate: 4 }, …]

// Anything company-specific needs a session. The A1 that signs the RPS opens
// the portal too, so no CPF and password are required:
const portal = await PortalService.authenticate({ certificate, cityCode: config.cityCode });
const mine = await portal.companyActivities();   // rate valid today, by default
```

Nothing that writes fires without `--confirm`.

## Documentation

| | |
| --- | --- |
| [examples/](examples/) | Runnable scripts, all checked against production |
| [docs/cli.md](docs/cli.md) | Every command, completion, documents and lookups |
| [docs/municipalities.md](docs/municipalities.md) | The cities that publish the Web Service |
| [docs/library.md](docs/library.md) | Using it as a package, and the 16 operations |
| [docs/configuration.md](docs/configuration.md) | `.env`, serving several companies, tax profile, homologation |
| [docs/issuing.md](docs/issuing.md) | What actually issues an invoice, and why |
| [docs/gotchas.md](docs/gotchas.md) | What the live service taught us the hard way |
| [docs/architecture.md](docs/architecture.md) | Layers, patterns, mTLS, SOAP and the signature |

Under `docs/`: technical manuals (Services Provided v1.6, Services Received/CST v2.5,
PIS/COFINS/CSLL v1.0), XSD schemas, XML samples and the errors and alerts spreadsheet.
Source: <https://suzano.giss.com.br/giss-ajuda/desenvolvedores.html>.

`docs/schemas-tomados/vigente/` carries the services-received XSD with the `tipos` v1_01
merged over v1_00 — necessary because the published v1_01 is a delta that does not compile
on its own. The originals stay untouched in the directory above.

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
