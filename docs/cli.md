# Command line

`giss` when installed globally, `npm run giss -- ...` inside the repository.
Every command takes `--env producao|homologacao`, `--json`, `--xml` and `--debug`.

## Commands

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
                                          # repeating the same --rps is safe:
                                          # an issued RPS is never issued twice
giss cancel --number 569 --reason 1 --confirm
giss replace --number 569 --reason 1 --customer acme --amount 15000 --confirm

# documents of an issued invoice
giss pdf --number 573                     # writes ./nfse-573.pdf
giss xml --number 573 --out ~/notas       # writes ~/notas/nfse-573.xml

# municipal activity table (CodigoTributacaoMunicipio)
giss activities --item 1.09
giss activities --company

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

## Shell completion

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

## Municipalities

```bash
giss cities                # every city known to publish the Web Service
giss cities --state SP     # just one state
```

Setting `GISS_MUNICIPIO` to the slug is enough — the IBGE code follows from it.
See [municipalities.md](municipalities.md).

## Municipal activities

`CodigoTributacaoMunicipio` has no national table: each city keeps its own, and
**neither Web Service publishes it** — the 16 operations issue, cancel, replace and
query invoices, nothing else. The table lives in the portal REST API:

```bash
giss activities                     # the whole city table
giss activities portais             # filter by code or description
giss activities --item 1.09         # filter by LC 116 item
giss activities --city 3518800      # another city, by IBGE code
giss activities --company           # only what your company is bound to
giss activities --company --date 2026-01-31
```

```
6319400  1.09      4.00%  Portais, Provedores De Conteúdo E Outros Serviços De Informação Na Internet
```

The first column is what goes in `CodigoTributacaoMunicipio`, the second is the LC 116
item it maps to — the two fields the invoice needs, resolved together.

The city table is **public**: it answers without login, so `giss activities` needs no
portal credentials and no certificate, only `GISS_MUNICIPIO` (or `--city`). Adding
`--company` switches to the authenticated route and returns the short list the company
can actually use — 4 activities against 964 in Suzano.

Three things the live API taught us:

- **The rate shown is the municipal one.** An optante do Simples Nacional pays the annex
  rate instead: copying this column would issue the invoice with the wrong tax.
- **The code format is decided by each city.** Suzano and Maceió use the 7-digit CNAE,
  Guarulhos and Santos use 6-digit occupation codes, and old short codes (`76`, `77`)
  survive in the same table.
- **So is the item format.** Suzano writes `1.09`, Guarulhos writes `101` for 1.01 and
  `100101` for a local sub-item. `--item` compares digits only, so `--item 1.09` works
  in both.

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
| Authentication | A1 certificate (mTLS) | JWT, from CPF/password **or from the A1** |
| Base | `https://ws-<city>.giss.com.br` | `https://<IBGE code>.giss.com.br` |
| Party directory | does not exist | `cliente-fornecedor/` (CRUD) |
| Invoice issuing | yes | — |

The REST login takes three steps: `POST login/token` with `grant_type=password`, then
`GET login/permissao` to list the linked companies, then `POST login/token` with
`grant_type=refresh_token` and the `PARAM_LOGIN`, `CODIGO_USUARIO` and
`PARAM_PRIV: empresa=<id>` headers.

The first step also accepts the **A1 certificate** instead of CPF and password, which is
what the CLI uses when `GISS_LOGIN`/`GISS_PASS` are absent — see
[configuration.md](configuration.md#logging-into-the-portal-with-the-certificate).

**It is an internal API with no public contract — it can change without notice.**

Two of its rules cost a debugging round each: contact fields are **objects**, not
strings (`email: {email}`, `telefone: {codigoArea, telefone}`) — plain strings
answer HTTP 500; and an update only persists when `alterado` is true, otherwise
the `PUT` answers 200 and silently changes nothing.
