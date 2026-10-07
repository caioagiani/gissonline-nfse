# Architecture

Layered, with dependencies always pointing inwards — `domain` knows nobody, `cli` knows
everyone:

```
src/
  domain/              rules and contracts, no I/O
    types.ts             Rps, Service, Amounts, ServiceTaker, Supplier…
    errors.ts            NfseError and its subclasses — see errors.md
    signature-policy.ts  Strategy: where the signature goes per operation
  infra/               I/O shared by every provider
    certificate.ts       .pfx → PEM (node-forge) and export
    xml-signer.ts        XMLDSig c14n + rsa-sha1 (GissOnline) or rsa-sha256 (national)
    transport-errors.ts  network, TLS and certificate failures → NfseError
    xml.ts               XML builders
  providers/           one folder per issuing system
    giss/                GissOnline — 32 cities
      soap-client.ts       SOAP 1.1 envelope and mTLS transport
      http-client.ts       JSON HTTP for the portal REST API
      messages/            provided-services, taken-services, parser
      nfse-service.ts      10 services-provided operations
      nfsc-service.ts      6 services-received operations
      portal-service.ts    directory, activities and messages via REST
      municipalities.ts    the cities that publish the Web Service
    nacional/            Sistema Nacional NFS-e (SEFIN + ADN)
      national-client.ts   REST/JSON over mTLS, gzip+base64 documents
      messages.ts          DPS, cancellation event, NFS-e parser
      national-service.ts  issue, query, cancel, DANFSe, distribution
  services/
    lookup-service.ts    postal code and CNPJ lookups (BrasilAPI)
  client.ts            NfseClient — facade composing every provider
  storage/             local persistence — Repository
    contact-repository.ts  customers and suppliers
    profile-repository.ts  tax profile + RPS assembly
    invoice-sync.ts        derives parties from invoices
  validation/          XSD validation (xmllint)
  config/              environment, endpoints and credentials
  cli/                 command line interface
  index.ts             public API
schemas/               official XSD, one folder per provider
  giss/prestados/        ABRASF 2.04 — services provided
  giss/tomados/          services received (vigente/ = v1_01 merged over v1_00)
  nacional/              national layout 1.01
docs/                  manuals, samples and the error table
```

**Patterns applied**, each solving a concrete problem that came up:

| Pattern | Where | Why |
| --- | --- | --- |
| **Strategy** | `domain/signature-policy.ts` | The signature changes per operation — root, inner element, one per RPS plus the batch, or none at all. As a strategy each rule is named and isolated instead of becoming a conditional in the client. |
| **Builder** | `providers/*/messages` | The XSD demand an exact element order; composed `element`/`group` calls make that order explicit and checkable against the schema. |
| **Repository** | `storage/` | Local directory and tax profile behind an interface. |
| **Facade** | `client.ts` | Loads the certificate once, builds both signers and hands over ready `nfse`/`nfsc`/`national` services. |
| **Adapter** | `providers/giss/soap-client.ts`, `http-client.ts`, `providers/nacional/national-client.ts` | Isolates SOAP and REST; services know neither `https` nor `fetch`, and the national transport can be swapped in tests. |

**Naming:** identifiers in English, with the standard's acronyms and entities preserved
(`Rps`, `Nfse`, `Iss`, `Cnpj`) so the code stays mappable line by line against the
official manuals and XSD.

## Adding a provider

A new issuing system gets `providers/<name>/` and `schemas/<name>/`, and a service on
`NfseClient`. It reuses `infra/` (certificate, signer, XML builders, error classification)
and `domain/` (the `Rps` the CLI already assembles). The national provider is the
reference: its DPS is built from the same `Rps` as the GissOnline RPS.

## How the integration works

1. **mTLS** — the WSDL and the endpoint only answer with an ICP-Brasil client certificate
   in the handshake (without it: `400 No required SSL certificate was sent`). The `.pfx` is
   converted to PEM in memory with `node-forge`, because Node's OpenSSL rejects the legacy
   ciphers Brazilian CAs use (`Unsupported PKCS12 PFX data`). To debug outside the app:

   ```bash
   nfse cert --export
   curl --cert cert/cert.pem --key cert/key.pem "https://ws-suzano.giss.com.br/service-ws/nf/nfse-ws?wsdl"
   ```

   The OpenSSL equivalent needs the `legacy` provider:

   ```bash
   openssl pkcs12 -legacy -in cert/*.pfx -clcerts -nokeys -out cert/cert.pem
   openssl pkcs12 -legacy -in cert/*.pfx -nocerts -nodes  -out cert/key.pem
   ```

2. **SOAP 1.1 envelope** — `document/literal wrapped`. The `nfse` service takes
   `nfseCabecMsg` + `nfseDadosMsg`; `nfsc` takes only `nfscDadosMsg`, with no version
   header, and uses a different namespace (`http://nfsc.eicon.com.br`).

3. **XMLDSig signature** — c14n `REC-xml-c14n-20010315` + `rsa-sha1` + `sha1` digest,
   enveloped, `KeyInfo` carrying only `X509Certificate`. Where it goes changes per
   operation:

   | Operation | Signature |
   | --- | --- |
   | Services-provided queries | root, `URI=""` |
   | `ConsultarNfseServicoTomado` | **none** — the XSD declares no `Signature` |
   | `GerarNfse` | inside `Rps`, `URI="#<InfDeclaracaoPrestacaoServico Id>"` |
   | `CancelarNfse` | inside `Pedido`, `URI="#<InfPedidoCancelamento Id>"` |
   | RPS batches | one per RPS plus the batch, `URI="#<LoteRps Id>"` |
   | `SubstituirNfse` | RPS + request + root, `URI="#<SubstituicaoNfse Id>"` |
   | `nfsc` operations | root, `URI=""` |

4. **Namespaces** are GissOnline's, not ABRASF's:
   `http://www.giss.com.br/<schema>-v2_04.xsd`, with complex types under
   `.../tipos-v2_04.xsd`. Services received use `v1_00`.
