# Gotchas

All found by testing against the live service:

- **Signing the whole batch is not enough.** The manual says the batch signature waives the
  individual ones, but the service answers `E174 — RPS não assinado`. Each RPS must be
  signed, and the batch signature must reference the `LoteRps` Id — with `URI=""` it
  invalidates the RPS signatures and `E174` comes back.
- **Signing where the XSD declares no `Signature` breaks the request** with `E160`. That is
  the case for `ConsultarNfseServicoTomado`.
- **Request format ≠ response format.** Queries return `ItemListaServico` as `1.04` while
  the request needs `01.04`; `CodigoNbs` comes back as `1.1703.10.00` and goes as
  `117031000` (9 chars max); `finNFSe` comes back `1` and only accepts `0`;
  `cLocalidadeIncid` comes back `1` and must be sent as the 7-digit IBGE code.
- **The ISS rate goes as a fraction** — 3.07% is sent as `0.0307`. See
  [issuing.md](issuing.md#only-the-async-batch-works).
- **`ConsultarServicoCompradoPorNumero` requires the declared number and series**, although
  the XSD marks them optional — without them the server answers HTTP 400.
- **The `nfsc` service double-encodes its text** ("Nota nÃ£o encontrada"); the client
  detects and fixes it.
- **`tipos-servicos-comprados-v1_01.xsd` is an incomplete delta** (54 types against 191 in
  v1_00) and does not compile on its own, despite sharing the `targetNamespace`. See
  `docs/schemas-tomados/vigente/`.
- **The `APP_ID` is per city, not global.** Each portal bundle carries its own; three
  cities even share one. `MUNICIPALITIES` maps them — see
  [municipalities.md](municipalities.md#the-portal-app_id).
- **The certificate login signs the nonce as bytes.** `login/certificado/nonce` answers
  base64; signing that text answers `Nonce inválido ou expirado`. Decode it first, sign
  with SHA-256, and get a fresh nonce per attempt — it is single-use.
- **The activity table swaps two fields on one route.** In
  `atividade/servicos/enquadrados/aliquotas` the backend fills `descricao` with the LC 116
  item and `codigoServico` with the description — the other route gets them right.
  `PortalService` decides by format (the item is always numeric), so both routes normalize
  to the same shape.
- **Every activity comes back `ativo: false`**, in all four cities checked, alongside an
  `inicio` date. It looks like versioning by validity, not deactivation: filtering by
  `ativo` leaves an empty list.
- **Beware of `toISOString` on competence dates**: at night in São Paulo it rolls the day
  forward and changes the invoice's competence.

The homologation environment has its own two limits, described in
[configuration.md](configuration.md#test-environment).
