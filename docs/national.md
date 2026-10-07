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
nfse national-status
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
nfse national-status                      # the two flags above
nfse national-docs [--from NSU]           # invoices and events where your CNPJ appears
nfse national-get --key K                 # one invoice by its 50-digit access key
nfse national-pdf --key K [--out DIR]     # the DANFSe, generated locally (see below)
nfse national-xml --key K [--out DIR]

nfse issue --issuer nacional --customer acme --amount 1500 --description "…"
nfse issue --issuer nacional --customer acme --amount 1500 --description "…" --dps 7 --confirm
nfse cancel --issuer nacional --key K --reason 1 --text "Valor informado errado" --confirm
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

## DANFSe (the PDF)

The national API no longer renders it. Technical Note 008 (v1.02, 2026-07-14) suspended
`adn.nfse.gov.br/danfse` on 2026-08-03 — it answers `503` since — and moved the duty to
the issuing system: the DANFSe is generated from the invoice XML, following the model in
Annex I. Generated that way it is the official auxiliary document, with the same standing
the API's PDF had.

`national.pdf(key)` does that: one call to `GET /contribuintes/NFSe/{key}/Eventos` on the
ADN returns the invoice and its events, and `renderDanfse` draws DANFSe v2.0. The events
decide the watermark — `SUBSTITUÍDA` for `105102`, `CANCELADA` for `101101`, `105104` and
`305101` — so a PDF never comes out clean for an invoice that no longer stands. That ADN
route only reaches invoices where the certificate's CNPJ appears.

With the XML already in hand, render it directly:

```ts
import { renderDanfse } from "nfse-br";
const pdf = await renderDanfse(xml, { status: "cancelled" }); // Uint8Array
```

What follows the note to the letter: the Annex I layout and the 2.4.5 positions, A4
portrait on one page, 0.5 pt dividers and a 1 pt border, 5% grey shading, the QR Code
pointing to `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=…`, the "NFS-e SEM
VALIDADE JURÍDICA" header in the restricted environment, only data present in the XML
(`-` where a field is empty), the suppression rules of 2.3 and the ellipsis limits.

Checked against DANFSe printed by the Emissor Nacional itself (MEI invoices, 2026-09):
same blocks, same codes for the generating environment and environment type, `-` for each
missing part of a composite field, optional ISSQN rows dropped when empty, and line
breaks in the description kept. Also checked against the DANFSe the public consultation
returns when our QR Code is scanned (invoice transcribed by the city, `ambGer` 1). That
fixed the official quirks we copy:

- IBGE code printed as `35.52502`, rates as `2,98 %`;
- the provider's phone and e-mail come only from the DPS, never from `emit`;
- special regime "Nenhum" (0) drops the ISSQN regime row;
- `0 - PIS/COFINS/CSLL Não Retidos`, with the code in front;
- `R$ 0,00`, not `-`, in exclusions, IBS/CBS total and net + IBS/CBS when the invoice has
  no `IBSCBS` group. The last one is wrong on their side (the net is not zero), but it
  is what the official document prints;
- the description takes only the room its text needs; the rest goes to the additional
  information.

One unavoidable difference: the note names Arial and Microsoft Sans Serif, which are
proprietary and cannot be embedded. The PDF uses Helvetica, the standard PDF font with the
same metrics as Arial. Characters outside its encoding (an emoji in a description) print
as `?`.

## Not verified yet

E0039 stops the restricted environment before it checks anything else. So the rules
below were written from the layout and the manuals, not confirmed against the live
service. The first test after the city flips the flag should confirm them:

- leaving out `pAliq` for ME/EPP apportioned through the Simples;
- leaving out the `IBSCBS` group, which is optional in layout 1.01;

## Hosts

| | Production | Restricted (test) |
| --- | --- | --- |
| SEFIN (issue, query, events) | `sefin.nfse.gov.br/SefinNacional` | `sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| ADN (distribution, events, parameters) | `adn.nfse.gov.br` | `adn.producaorestrita.nfse.gov.br` |

`--env homologacao` selects the restricted environment, which has no fiscal effect.

Schemas: `schemas/nacional/` holds the official XSD v1.01 (2026-02-09), from
<https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual>.
Do not confuse it with **NFS-e Via**, a separate layout used only for road tolls (service
`220101`).
