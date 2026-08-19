# Municipalities

The Web Service is the same in every city that runs GissOnline — same 16
operations, same WSDL, same signature. Only the host changes:
`ws-<slug>.giss.com.br`.

**32 municipalities** answer it today, 24 of them in São Paulo:

| `GISS_MUNICIPIO` | City | UF | IBGE code |
| --- | --- | --- | --- |
| `maceio` | Maceió | AL | `2704302` |
| `marechaldeodoro` | Marechal Deodoro | AL | `2704708` |
| `mineiros` | Mineiros | GO | `5213103` |
| `contagem` | Contagem | MG | `3118601` |
| `muriae` | Muriaé | MG | `3143906` |
| `caruaru` | Caruaru | PE | `2604106` |
| `paulista` | Paulista | PE | `2610707` |
| `umuarama` | Umuarama | PR | `4128104` |
| `bertioga` | Bertioga | SP | `3506359` |
| `capivari` | Capivari | SP | `3510401` |
| `diadema` | Diadema | SP | `3513801` |
| `embuguacu` | Embu-Guaçu | SP | `3515103` |
| `guararema` | Guararema | SP | `3518305` |
| `guaruja` | Guarujá | SP | `3518701` |
| `guarulhos` | Guarulhos | SP | `3518800` |
| `hortolandia` | Hortolândia | SP | `3519071` |
| `itu` | Itu | SP | `3523909` |
| `jaboticabal` | Jaboticabal | SP | `3524303` |
| `jardinopolis` | Jardinópolis | SP | `3525102` |
| `jundiai` | Jundiaí | SP | `3525904` |
| `maua` | Mauá | SP | `3529401` |
| `olimpia` | Olímpia | SP | `3533908` |
| `paulinia` | Paulínia | SP | `3536505` |
| `piedade` | Piedade | SP | `3537800` |
| `praiagrande` | Praia Grande | SP | `3541000` |
| `registro` | Registro | SP | `3542602` |
| `ribeiraopires` | Ribeirão Pires | SP | `3543303` |
| `rioclaro` | Rio Claro | SP | `3543907` |
| `salto` | Salto | SP | `3545209` |
| `santoandre` | Santo André | SP | `3547809` |
| `santos` | Santos | SP | `3548500` |
| `suzano` | Suzano | SP | `3552502` |

Set `GISS_MUNICIPIO` to the slug and the IBGE code follows from it — passing
`GISS_CODIGO_MUNICIPIO` explicitly still wins. `giss cities [--state SP]` prints
this table, and `MUNICIPALITIES` exports it to the library.

## How this list was made

The 32 were found by resolving all 5,288 municipality slugs from the IBGE
against `ws-<slug>.giss.com.br`, then confirming the 16 operations on every host
that answered. Nobody publishes this list, so it is a snapshot: city halls come
and go. Homonyms (`santoandre`, `rioclaro`, `praiagrande`, `jardinopolis`,
`paulista`) were resolved through the DNS of `<ibgeCode>.giss.com.br`, the portal
subdomain.

## What "supported" does and does not mean

A signed query against Guarulhos, Santos and Santo André answers
`E361 — Empresa não localizada`. That failure is the good news: mTLS, the SOAP
envelope, the XMLDSig signature and the schema all passed, and the service only
stopped at the company registration. The client reaches these cities with no
code change.

What it does **not** prove is that the issuing rules match. Rates, service list
items and required fields are configured per city hall, and that is exactly
where Suzano cost us days — `E163`, `E165`, `cLocalidadeIncid`. Treat a new
municipality as unverified until a real invoice comes out of it.

## The portal `APP_ID`

The REST API expects an `APP_ID` header, and it is **not the same everywhere**:
each city's `portal/js/app.js` carries its own. `MUNICIPALITIES` maps the 30 that
answered — Contagem and Salto refuse the bundle (`ECONNRESET`), so they have none
and fall back to Suzano's, which the public activity routes accepted in Guarulhos,
Santos and Maceió. `PortalService` picks it by IBGE code; pass `appId` to override.

It is not one per city either: Guarujá, Maceió and Santo André share
`c7d920e2-…`, which suggests one id per portal instance rather than per
municipality.

None of this is a secret — the value ships in a public JavaScript bundle that
every visitor downloads.
