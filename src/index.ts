/** API pública da biblioteca. */

export { loadConfig, hostFor, loadPortalCredentials } from "./config/index.ts";
export type { Environment, GissConfig } from "./config/index.ts";

export { GissError, PortalError, SoapFaultError } from "./domain/errors.ts";
export type { ServiceMessage } from "./domain/errors.ts";

export * from "./domain/types.ts";
export * from "./domain/signature-policy.ts";

export { loadCertificate, exportPem } from "./infra/certificate.ts";
export type {
  Certificate,
  CertificateInput,
  ExportedFiles,
} from "./infra/certificate.ts";
export { createXmlSigner } from "./infra/xml-signer.ts";
export { SOAP_SERVICES } from "./infra/soap-client.ts";
export type {
  NfscOperation,
  NfseOperation,
  SoapOperation,
  SoapService,
} from "./infra/soap-client.ts";

export { GissClient } from "./services/giss-client.ts";
export type { GissClientOptions } from "./services/giss-client.ts";
export { NfseService } from "./services/nfse-service.ts";
export type { IssueOutcome } from "./services/nfse-service.ts";
export { NfscService } from "./services/nfsc-service.ts";
export { PortalService, buildPortalParty } from "./services/portal-service.ts";
export type {
  DocumentFormat,
  PartyRole,
  PortalCredentials,
  PortalParty,
  PortalSession,
} from "./services/portal-service.ts";

export { BATCH_STATUS } from "./messages/parser.ts";
export type {
  BatchResult,
  CancellationResult,
  Nfse,
  Party,
  ProtocolResult,
  QueryResult,
} from "./messages/parser.ts";

export { ContactRepository, taxIdOf } from "./storage/contact-repository.ts";
export type { Contact, ContactRole } from "./storage/contact-repository.ts";
export {
  ProfileRepository,
  DEFAULT_PROFILE,
  buildRps,
} from "./storage/profile-repository.ts";
export type { IssueInput, IssuingProfile } from "./storage/profile-repository.ts";
export { syncFromInvoices } from "./storage/invoice-sync.ts";

export { validateAgainstSchema } from "./validation/schema-validator.ts";
export type { ValidationResult } from "./validation/schema-validator.ts";
