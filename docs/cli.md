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
