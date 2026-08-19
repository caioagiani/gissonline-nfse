# Using it as a library

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

## What a queried invoice carries

Beyond the printed number and the amounts, two fields exist because the service
needs them back:

| | |
| --- | --- |
| `internalId` | `InfNfse@Id` — what the portal's PDF and XML routes take, since the printed number does not work there |
| `rps` | the RPS that produced the invoice, ready to hand back to `findByRps` |

`rps` is absent on invoices typed into the portal by hand: those never went
through an RPS. In this account only 4 of 20 invoices this year came from one,
so check before assuming.

```ts
const { invoices } = await giss.nfse.queryProvidedServices({ nfseNumber: "574" });
const { rps } = invoices[0];
if (rps) await giss.nfse.findByRps(rps);   // no massaging needed
```

Two more live in `PortalService`, because the Web Service has no equivalent —
the activity table behind `CodigoTributacaoMunicipio`:

```ts
import { PortalService, resolveCityCode } from "gissonline-nfse";

// public: no login, no certificate
const all = await PortalService.listActivities(resolveCityCode("suzano"));

// authenticated: only what this company is bound to, with the rate valid on the date
const portal = await PortalService.authenticate(credentials);
const mine = await portal.companyActivities(new Date());
// [{ code: "6319400", serviceListItem: "1.09", description: "Portais…", rate: 4 }]
```

See [configuration.md](configuration.md) for serving several companies from one
process, and [issuing.md](issuing.md) for what actually issues an invoice.
