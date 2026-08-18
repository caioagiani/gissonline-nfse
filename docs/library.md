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

See [configuration.md](configuration.md) for serving several companies from one
process, and [issuing.md](issuing.md) for what actually issues an invoice.
