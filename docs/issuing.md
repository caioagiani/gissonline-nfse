# Issuing

## Only the async batch works

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

See [gotchas.md](gotchas.md) for the rest of what the live service taught us.
