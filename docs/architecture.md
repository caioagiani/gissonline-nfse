# Architecture

Layered, with dependencies always pointing inwards — `domain` knows nobody, `cli` knows
everyone:

```
src/
  domain/              rules and contracts, no I/O
    types.ts             Rps, Service, Amounts, ServiceTaker, Supplier…
    errors.ts            GissError, SoapFaultError, PortalError
    signature-policy.ts  Strategy: where the signature goes per operation
  infra/               I/O and technical detail
    certificate.ts       .pfx → PEM (node-forge) and export
    xml-signer.ts        XMLDSig c14n + rsa-sha1
    soap-client.ts       SOAP 1.1 envelope and mTLS transport
    http-client.ts       JSON HTTP for the REST API
    xml.ts               XML builders
  messages/            serialisation — Builder
    provided-services.ts XML for the nfse service
    taken-services.ts    XML for the nfsc service
    parser.ts            responses → objects
  services/            use cases
    nfse-service.ts      10 services-provided operations
    nfsc-service.ts      6 services-received operations
    portal-service.ts    directory via REST API
    giss-client.ts       facade composing the services
  storage/             local persistence — Repository
    contact-repository.ts  customers and suppliers
    profile-repository.ts  tax profile + RPS assembly
    invoice-sync.ts        derives parties from invoices
  validation/          XSD validation (xmllint)
  config/              environment, endpoints and credentials
  cli/                 command line interface
  index.ts             public API
docs/                  manuals, XSD schemas, samples and the error table
```

**Patterns applied**, each solving a concrete problem that came up:

| Pattern | Where | Why |
| --- | --- | --- |
| **Strategy** | `domain/signature-policy.ts` | The signature changes per operation — root, inner element, one per RPS plus the batch, or none at all. As a strategy each rule is named and isolated instead of becoming a conditional in the client. |
| **Builder** | `messages/` | The XSD demand an exact element order; composed `element`/`group` calls make that order explicit and checkable against the schema. |
| **Repository** | `storage/` | Local directory and tax profile behind an interface. |
| **Facade** | `services/giss-client.ts` | Loads the certificate, builds the signer and hands over ready `nfse`/`nfsc` services. |
| **Adapter** | `infra/soap-client.ts`, `http-client.ts` | Isolates SOAP and REST; services know neither `https` nor `fetch`. |

**Naming:** identifiers in English, with the standard's acronyms and entities preserved
(`Rps`, `Nfse`, `Iss`, `Cnpj`) so the code stays mappable line by line against the
official manuals and XSD.

## How the integration works

1. **mTLS** — the WSDL and the endpoint only answer with an ICP-Brasil client certificate
   in the handshake (without it: `400 No required SSL certificate was sent`). The `.pfx` is
   converted to PEM in memory with `node-forge`, because Node's OpenSSL rejects the legacy
   ciphers Brazilian CAs use (`Unsupported PKCS12 PFX data`). To debug outside the app:

   ```bash
   giss cert --export
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
