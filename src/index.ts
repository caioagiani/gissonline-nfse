/** API pública da biblioteca. */

export {
  loadConfig,
  hostFor,
  loadPortalCredentials,
  resolveCityCode,
} from "./config/index.ts";
export {
  MUNICIPALITIES,
  findMunicipality,
  type Municipality,
} from "./providers/giss/municipalities.ts";
export type { Environment, GissConfig, Issuer } from "./config/index.ts";

export {
  CertificateError,
  ConfigError,
  GissError,
  NationalError,
  NfseError,
  NotSupportedError,
  PortalError,
  SoapFaultError,
  TransportError,
  ValidationError,
} from "./domain/errors.ts";
export type {
  NfseErrorCode,
  NfseErrorOptions,
  NfseProvider,
  ServiceMessage,
} from "./domain/errors.ts";

export * from "./domain/types.ts";
export * from "./domain/signature-policy.ts";

export { loadCertificate, exportPem } from "./infra/certificate.ts";
export type {
  Certificate,
  CertificateInput,
  ExportedFiles,
} from "./infra/certificate.ts";
export { createXmlSigner } from "./infra/xml-signer.ts";
export type { SignatureAlgorithm } from "./infra/xml-signer.ts";
export { SOAP_SERVICES } from "./providers/giss/soap-client.ts";
export type {
  NfscOperation,
  NfseOperation,
  SoapOperation,
  SoapService,
} from "./providers/giss/soap-client.ts";

export { NfseClient, GissClient } from "./client.ts";
export type { NfseClientOptions, GissClientOptions } from "./client.ts";
export {
  lookupZip,
  lookupCompany,
  lookupParty,
  LookupError,
  type ZipLookup,
  type CompanyLookup,
} from "./services/lookup-service.ts";

export { NfseService } from "./providers/giss/nfse-service.ts";
export type { IssueOutcome } from "./providers/giss/nfse-service.ts";
export { NfscService } from "./providers/giss/nfsc-service.ts";
export { NationalService, NATIONAL_HOSTS } from "./providers/nacional/national-service.ts";
export type {
  DistributedDocument,
  MunicipalAgreement,
  NationalIssueOptions,
  NationalIssueOutcome,
  NationalServiceOptions,
} from "./providers/nacional/national-service.ts";
export {
  buildDps,
  buildCancellationEvent,
  dpsId,
  nationalTaxCode,
  parseNationalNfse,
  NATIONAL_NAMESPACE,
  NATIONAL_VERSION,
} from "./providers/nacional/messages.ts";
export type {
  DpsContext,
  NationalCancellationReason,
  NationalEnvironment,
  NationalNfse,
  SimplesOption,
} from "./providers/nacional/messages.ts";
export { PortalService, buildPortalParty } from "./providers/giss/portal-service.ts";
export type {
  AnyPortalCredentials,
  DocumentFormat,
  MunicipalActivity,
  NewPortalMessage,
  PartyRole,
  PortalMessage,
  PortalMessageAttachment,
  PortalCertificateCredentials,
  PortalCredentials,
  PortalParty,
  PortalSession,
} from "./providers/giss/portal-service.ts";

export { BATCH_STATUS } from "./providers/giss/messages/parser.ts";
export type {
  BatchResult,
  CancellationResult,
  Nfse,
  Party,
  ProtocolResult,
  QueryResult,
  RpsIdentification,
} from "./providers/giss/messages/parser.ts";

export { ContactRepository, taxIdOf } from "./storage/contact-repository.ts";
export type { Contact, ContactRole } from "./storage/contact-repository.ts";
export {
  ProfileRepository,
  DEFAULT_PROFILE,
  buildRps,
} from "./storage/profile-repository.ts";
export type { IssueInput, IssuingProfile } from "./storage/profile-repository.ts";
export { syncFromInvoices } from "./storage/invoice-sync.ts";

export {
  SCHEMA_DIRECTORIES,
  validateAgainstSchema,
} from "./validation/schema-validator.ts";
export type { ValidationResult } from "./validation/schema-validator.ts";
