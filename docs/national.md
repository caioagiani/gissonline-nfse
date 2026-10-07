# National issuer (Sistema Nacional NFS-e)

From **2026-11-01**, companies in the Simples Nacional (ME and EPP) can no longer issue
NFS-e through the city's own system: Resolução CGSN nº 191/2026 moves them to the
national standard, through the national issuer — web or API. Until 2026-10-31,
GissOnline keeps working as before.

This client speaks the national API with the **same A1 certificate**. There is no
token and no separate registration: mutual TLS identifies the company.

```bash
NFSE_EMISSOR=nacional        # in .env — or --issuer nacional per command
```

With that set, `issue` and `cancel` go through the national API. Everything else
(queries, portal, directory) stays on GissOnline.

## Before the first invoice: is the city ready?

```bash
giss national-status
```

```
Shares with national:    yes
Accepts national issuer: no
```

These are two separate switches, and **both belong to the city**:

| Flag (ADN) | Meaning |
| --- | --- |
| `aderenteAmbienteNacional` | the city shares its own system's invoices with the national base |
| `aderenteEmissorNacional` | the city accepts invoices from the national issuer |

While the second one is `0`, every DPS is refused with
`E0039 — O município emissor informado na DPS deve estar parametrizado para utilizar
os emissores públicos nacionais`. That holds for the web issuer and the API alike,
and in the restricted environment too. Nothing on the taxpayer side changes it.

Checked on 2026-10-06 for Suzano (3552502): shares `yes`, accepts `no`.

## Commands

```bash
giss national-status                      # the two flags above
giss national-docs [--from NSU]           # invoices and events where your CNPJ appears
giss national-get --key K                 # one invoice by its 50-digit access key
giss national-pdf --key K [--out DIR]     # the DANFSe
giss national-xml --key K [--out DIR]

giss issue --issuer nacional --customer acme --amount 1500 --description "…"
giss issue --issuer nacional --customer acme --amount 1500 --description "…" --dps 7 --confirm
giss cancel --issuer nacional --key K --reason 1 --text "Valor informado errado" --confirm
```

`national-docs` already lists the invoices issued through GissOnline: a city that
shares with the national base forwards them, with their national access key.

## How issuing works

The DPS (Declaração de Prestação de Serviço) plays the role of the RPS. It is built from
the same `Rps` the GissOnline path uses, so the tax profile, the directory and the CLI
flags serve both. The SEFIN validates it and answers with the invoice at once, with no
batch and no protocol.

- **Retrying is safe with `--dps`.** The DPS id is city + CNPJ + series + number. Before
  sending, the client asks the SEFIN whether that DPS already became an invoice, and if
  it did, returns that invoice. Without `--dps`, the number is the current Unix time.
- **The series** comes from `nationalSeries` in the profile (default `1`).
- **Simples Nacional**: `opSimpNac` comes from `simplesOption` in the profile, or `3`
  (ME/EPP) when `simplesNacionalOptant` is `1`. When everything is apportioned through
  the Simples (`regApTribSN = 1`), the ISS rate is left out of the DPS, because it comes
  from the PGDAS and not from the invoice.
- **The signature is SHA-256.** GissOnline only validates SHA-1. The national API takes
  SHA-256, so the client uses it there.
- **Cancelling is an event** (`101101`) on the access key, with reason `1` (issuing error),
  `2` (service not provided) or `9` (other) and a justification of 15 to 255 characters.
  `replace` is not available on this path yet: cancel, then issue again.

## Not verified yet

E0039 stops the restricted environment before it checks anything else. So the rules
below were written from the layout and the manuals, not confirmed against the live
service. The first test after the city flips the flag should confirm them:

- leaving out `pAliq` for ME/EPP apportioned through the Simples;
- leaving out the `IBSCBS` group, which is optional in layout 1.01;
- `GET /danfse/{key}` on the ADN answered `503` on 2026-10-06 for every key tried.

## Hosts

| | Production | Restricted (test) |
| --- | --- | --- |
| SEFIN (issue, query, events) | `sefin.nfse.gov.br/SefinNacional` | `sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| ADN (distribution, DANFSe, parameters) | `adn.nfse.gov.br` | `adn.producaorestrita.nfse.gov.br` |

`--env homologacao` selects the restricted environment, which has no fiscal effect.

Schemas: `docs/schemas-nacional/` holds the official XSD v1.01 (2026-02-09), from
<https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual>.
Do not confuse it with **NFS-e Via**, a separate layout used only for road tolls (service
`220101`).
