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

## The rate has no default

`DEFAULT_PROFILE` carries no `rate`, and `buildRps` refuses to assemble an RPS
without one whenever the ISS is chargeable (`issTaxability: 1`). That is
deliberate: the rate belongs to each taxpayer, so a default would quietly issue
invoices with the wrong tax — worse than failing. Non-chargeable cases
(exemption, non-incidence, export) assemble without it.

Without the check the service answers `E163`, and only when you query the
batch protocol — long after the send looked fine.

```ts
buildRps(profile, { taker, serviceAmount: 100, description: "…", rate: 3.07 });
// or set `rate` once in the profile
```

## Issuing without issuing twice

Because the batch is asynchronous, there is a window between "sent" and "the
invoice exists" in which a process can die. Retrying is the natural reaction,
and it is exactly what creates a duplicate — which is not a bug to fix later
but a cancellation and a conversation with the city hall.

The RPS number is what prevents it: it identifies the *intent* to issue, and
the service accepts it once. `issueRps` checks by RPS before sending and again
after waiting, so a repeat returns the invoice already issued instead of making
a second one:

```ts
const outcome = await giss.nfse.issueRps(rps);   // rps.identification.number required

switch (outcome.status) {
  case "issued":         // it was created now
  case "already-issued": // a previous attempt had created it — outcome.invoice
  case "pending":        // accepted, still processing — retry with outcome.protocol
  case "rejected":       // the service refused it — see outcome.warnings
}
```

The number has to come from **your** side and be stable across attempts — a
number generated per call defeats the whole thing. In a multi-company setup
that means reserving it transactionally before sending. `issueRps` refuses to
run without one rather than let a retry duplicate silently.

`findByRps` is the same check on its own, returning `undefined` instead of
throwing when the invoice does not exist yet.
See [gotchas.md](gotchas.md) for the rest of what the live service taught us.
