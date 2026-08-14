# gissonline-nfse

Cliente Node/TypeScript para os Web Services do **GissOnline** — NFS-e no padrão ABRASF 2.04 com
as extensões da LC 214/2025 (NT SE/CGNFS-e nº 007). Configurado para Suzano/SP, mas o município é
uma variável de ambiente.

Cobre as **16 operações** dos dois serviços SOAP publicados — `nfse` (serviços prestados) e `nfsc`
(serviços tomados) — mais a API REST do portal, único caminho para o cadastro de clientes e
fornecedores.

- Emissão, cancelamento e substituição de NFS-e, avulsas ou em lote
- Consultas por período, competência, faixa, RPS e protocolo
- Declaração de serviços tomados (notas de fornecedor)
- Assinatura XMLDSig com certificado A1, no formato que cada operação exige
- Validação contra os XSD oficiais antes de enviar
- Nenhuma operação de escrita dispara sem `--confirmar`

## Requisitos

- Node 24+ (roda `.ts` nativamente)
- Certificado digital A1 ICP-Brasil (`.pfx`) do prestador
- `xmllint` (opcional) — habilita a validação contra os XSD antes de enviar

```bash
npm install
cp .env.example .env             # preencha as credenciais
cp /caminho/do/certificado.pfx cert/    # a pasta já vem no repositório, vazia
```

As pastas `cert/` e `dados/` são versionadas vazias (só com `.gitkeep`) para
marcar onde os arquivos ficam — o conteúdo delas nunca entra no repositório.

## Arquitetura

Camadas, com dependências sempre apontando para dentro — `domain` não conhece
ninguém, `cli` conhece todos:

```
src/
  domain/              regras e contratos, sem I/O
    types.ts             Rps, Service, Amounts, ServiceTaker, Supplier…
    errors.ts            GissError, SoapFaultError, PortalError
    signature-policy.ts  Strategy: onde a assinatura entra em cada operação
  infra/               I/O e detalhes técnicos
    certificate.ts       .pfx → PEM (node-forge) e exportação
    xml-signer.ts        XMLDSig c14n + rsa-sha1
    soap-client.ts       envelope SOAP 1.1 e transporte mTLS
    http-client.ts       HTTP JSON para a API REST
    xml.ts               construtores de XML
  messages/            serialização — Builder
    provided-services.ts XMLs do serviço nfse
    taken-services.ts    XMLs do serviço nfsc
    parser.ts            respostas → objetos
  services/            casos de uso
    nfse-service.ts      10 operações de serviços prestados
    nfsc-service.ts      6 operações de serviços tomados
    portal-service.ts    cadastro via API REST
    giss-client.ts       fachada que compõe os serviços
  storage/             persistência local — Repository
    contact-repository.ts  clientes e fornecedores
    profile-repository.ts  perfil fiscal + montagem do RPS
    invoice-sync.ts        deriva participantes das notas
  validation/          validação contra os XSD (xmllint)
  config/              ambiente, endpoints e credenciais
  cli/                 interface de linha de comando
  index.ts             API pública
docs/                  manuais, schemas XSD, exemplos e tabela de erros
```

**Padrões aplicados**, cada um resolvendo um problema concreto que apareceu:

| Padrão | Onde | Por quê |
| --- | --- | --- |
| **Strategy** | `domain/signature-policy.ts` | A assinatura muda por operação — raiz, elemento interno, uma por RPS mais a do lote, ou nenhuma. Como estratégia, cada regra fica nomeada e isolada em vez de virar condicional no cliente. |
| **Builder** | `messages/` | Os XSD exigem ordem exata de elementos; funções compostas de `element`/`group` tornam essa ordem explícita e conferível contra o schema. |
| **Repository** | `storage/` | Cadastro local e perfil fiscal atrás de uma interface, com migração de formato transparente. |
| **Facade** | `services/giss-client.ts` | Carrega certificado, monta o assinador e entrega `nfse`/`nfsc` prontos. |
| **Adapter** | `infra/soap-client.ts`, `http-client.ts` | Isola SOAP e REST; os serviços não conhecem `https` nem `fetch`. |

**Convenção de nomes:** identificadores em inglês, siglas e entidades do padrão
preservadas (`Rps`, `Nfse`, `Iss`, `Cnpj`). Assim o código continua mapeável
linha a linha contra os manuais e os XSD. Comentários e mensagens ao usuário
seguem em português.

## Configuração (`.env`)

| Variável | Descrição |
| --- | --- |
| `GISS_ENV` | `producao` ou `homologacao` |
| `GISS_MUNICIPIO` | slug do município no host (`suzano` → `ws-suzano.giss.com.br`) |
| `GISS_VERSAO` | versão do leiaute (`2.04`) |
| `GISS_CODIGO_MUNICIPIO` | código IBGE (Suzano = `3552502`) |
| `CERT_PATH` / `CERT_PASSWORD` | certificado A1 e senha |
| `GISS_CNPJ` / `GISS_ISC_MUNICIPAL` | prestador |

## Uso

```bash
npm run giss                                  # ajuda com todos os comandos
npm run giss -- cert [--exportar]             # certificado; --exportar grava os PEM

# consultas — serviços prestados
npm run giss -- ultimas [--limite 10] [--meses 12]   # as NFS-e mais recentes
npm run giss -- prestado --inicio 2026-07-01 --fim 2026-07-31 [--competencia] [--todas]
npm run giss -- faixa --de 555 --ate 569
npm run giss -- rps --numero 12 --serie A
npm run giss -- lote --protocolo 202607000123

# consultas — serviços tomados
npm run giss -- tomado --inicio 2026-07-01 --fim 2026-07-31
npm run giss -- comprado-lote --protocolo P
npm run giss -- comprado-protocolo --protocolo P
npm run giss -- comprado-numero --inicio D --fim D --numero N --serie S

# emissão (sem --confirmar nada é enviado)
npm run giss -- emitir --tomador exemplo --valor 15000 --descricao "Desenvolvimento de software"
npm run giss -- emitir --tomador exemplo --valor 15000 --rps 12 --confirmar
npm run giss -- cancelar --numero 569 --motivo 1 --confirmar
npm run giss -- substituir --numero 569 --motivo 1 --tomador exemplo --valor 15000 --confirmar

# cadastros locais
npm run giss -- clientes --sincronizar --inicio 2026-01-01 --fim 2026-12-31
npm run giss -- fornecedores
npm run giss -- cliente-add --documento 00000000000191 --nome "Cliente Exemplo LTDA" --apelido exemplo
npm run giss -- perfil [--salvar]
```

Flags globais: `--env producao|homologacao`, `--json`, `--xml`, `--debug`.

Como biblioteca:

```ts
import { GissClient, ContactRepository, ProfileRepository, buildRps } from "./src/index.ts";

const giss = new GissClient();

// consulta
const { invoices } = await giss.nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});

// paginação automática
for await (const page of giss.paginate((page) =>
  giss.nfse.queryProvidedServices({ issuePeriod: { from, to }, page }),
)) {
  console.log(page.invoices.length);
}

// emissão
const taker = ContactRepository.asServiceTaker(
  new ContactRepository().find("cliente", "exemplo")!,
);
const rps = buildRps(new ProfileRepository().load(), {
  taker,
  serviceAmount: 1500,
  description: "Desenvolvimento de software",
});

giss.nfse.previewIssueNfse(rps);   // XML assinado, sem enviar
await giss.nfse.issueNfse(rps);    // emite de verdade
```

## Operações

| Serviço | Operação | Método | Estado |
| --- | --- | --- | --- |
| nfse | ConsultarNfseServicoPrestado | `nfse.queryProvidedServices` | validado em produção |
| nfse | ConsultarNfsePorFaixa | `nfse.queryNfseRange` | validado em produção |
| nfse | ConsultarNfsePorRps | `nfse.queryNfseByRps` | validado em produção |
| nfse | ConsultarLoteRps | `nfse.queryRpsBatch` | validado em produção |
| nfse | ConsultarNfseServicoTomado | `nfse.queryTakenServices` | responde `A01` (ver limitações) |
| nfse | GerarNfse | `nfse.issueNfse` | schema + assinatura aceitos em homologação |
| nfse | RecepcionarLoteRps | `nfse.sendRpsBatch` | schema + assinatura aceitos em homologação |
| nfse | RecepcionarLoteRpsSincrono | `nfse.sendRpsBatchSync` | schema + assinatura aceitos em homologação |
| nfse | CancelarNfse | `nfse.cancelNfse` | schema + assinatura aceitos em homologação |
| nfse | SubstituirNfse | `nfse.replaceNfse` | schema + assinatura aceitos em homologação |
| nfsc | EmitirNotaServicoComprado | `nfsc.issuePurchasedService` | XML valida contra o XSD |
| nfsc | EnviarLoteNotaServicoComprado | `nfsc.sendPurchasedServiceBatch` | XML valida contra o XSD |
| nfsc | CancelarNotaServicoComprado | `nfsc.cancelPurchasedService` | XML valida contra o XSD |
| nfsc | ConsultarServicoCompradoPorLote | `nfsc.queryPurchasedByBatch` | validado em produção |
| nfsc | ConsultarServicoCompradoPorProtocolo | `nfsc.queryPurchasedByProtocol` | validado em produção |
| nfsc | ConsultarServicoCompradoPorNumero | `nfsc.queryPurchasedByNumber` | validado em produção |

"Validado em produção" = a operação foi executada contra `ws-suzano` e devolveu dados ou uma
resposta de negócio coerente. As de emissão só foram até onde o ambiente de homologação
permite (a empresa não está cadastrada lá) — **nenhuma nota foi emitida**.

## Cadastro de clientes e fornecedores

O **Web Service SOAP não tem cadastro** — a lista de serviços publicada em `/service-ws/` traz só
as 16 operações de nota, e no padrão ABRASF os dados do participante viajam dentro de cada NFS-e.

O cadastro que aparece no portal (*Manutenção Cadastral → Clientes e Fornecedores*) roda numa
**API REST separada**, implementada em `src/services/portal-service.ts`:

```bash
npm run giss -- portal-clientes                  # clientes cadastrados no portal
npm run giss -- portal-clientes --tipo 2         # fornecedores
npm run giss -- portal-add --documento 00000000000191 --nome "Cliente Exemplo LTDA" \
    --logradouro "Bom Sucesso" --numero 220 --bairro Centro \
    --cidade 3550308 --uf SP --cep 03305-000 --confirmar
npm run giss -- portal-rm --documento ... --confirmar
npm run giss -- portal-importar                  # traz o cadastro do portal para o catálogo local
```

Sem `--confirmar` nada é enviado: o comando imprime o payload para conferência.

| | SOAP (`/service-ws/`) | REST (`service-empresa/api/`) |
| --- | --- | --- |
| Autenticação | certificado A1 (mTLS) | JWT de login CPF/senha (`GISS_LOGIN`/`GISS_PASS`) |
| Base | `https://ws-<municipio>.giss.com.br` | `https://<códigoIBGE>.giss.com.br` |
| Cadastro de participantes | não existe | `cliente-fornecedor/` (CRUD) |
| Emissão de NFS-e | sim | — |

O login REST tem três passos, na ordem que o portal usa:

1. `POST login/token` com `grant_type=password` → token sem empresa;
2. `GET login/permissao` → empresas vinculadas (`idEmpresa`, `idCliente`, `clienteReferencia`);
3. `POST login/token` com `grant_type=refresh_token` e os cabeçalhos `PARAM_LOGIN`,
   `CODIGO_USUARIO` e `PARAM_PRIV: empresa=<idEmpresa>` → token final.

Detalhes que custaram tentativa e erro: o campo `cidade` do endereço grava o **nome** do
município (`"SAO PAULO"`), não o código — resolvido por `municipio-ibge/listar/<uf>`, cuja chave é
`idMunicipioIbge`; e `idUfIbge` são os dois primeiros dígitos do código do município.

**É API interna, sem contrato público — pode mudar sem aviso.**

Além disso, o projeto mantém um catálogo local em `dados/catalogo.json`, alimentado por
`portal-importar` ou por `clientes --sincronizar` (que deriva das notas já emitidas). É ele que
resolve `--tomador exemplo` na emissão, por apelido, documento ou trecho da razão social.

## Como a integração funciona

1. **mTLS** — o WSDL e o endpoint só respondem com certificado cliente ICP-Brasil no handshake
   (sem ele: `400 No required SSL certificate was sent`). O `.pfx` é convertido para PEM em
   memória com `node-forge`, porque o OpenSSL do Node recusa as cifras legadas das ACs
   brasileiras (`Unsupported PKCS12 PFX data`). Para depurar fora da aplicação:

   ```bash
   npm run giss -- cert --exportar
   curl --cert cert/cert.pem --key cert/key.pem "https://ws-suzano.giss.com.br/service-ws/nf/nfse-ws?wsdl"
   ```

   O equivalente pelo OpenSSL exige o provider `legacy`:

   ```bash
   openssl pkcs12 -legacy -in cert/*.pfx -clcerts -nokeys -out cert/cert.pem
   openssl pkcs12 -legacy -in cert/*.pfx -nocerts -nodes  -out cert/key.pem
   ```

2. **Envelope SOAP 1.1** — `document/literal wrapped`. O serviço `nfse` recebe `nfseCabecMsg` +
   `nfseDadosMsg`; o `nfsc` recebe apenas `nfscDadosMsg`, sem cabeçalho de versão, e usa outro
   namespace (`http://nfsc.eicon.com.br`).

3. **Assinatura XMLDSig** — c14n `REC-xml-c14n-20010315` + `rsa-sha1` + digest `sha1`,
   enveloped, `KeyInfo` só com `X509Certificate`. Onde a assinatura vai muda por operação:

   | Operação | Assinatura |
   | --- | --- |
   | Consultas de serviços prestados | raiz, `URI=""` |
   | `ConsultarNfseServicoTomado` | **nenhuma** — o XSD não declara `Signature` |
   | `GerarNfse` | dentro de `Rps`, `URI="#<Id do InfDeclaracaoPrestacaoServico>"` |
   | `CancelarNfse` | dentro de `Pedido`, `URI="#<Id do InfPedidoCancelamento>"` |
   | Lotes de RPS | uma por RPS + uma do lote com `URI="#<Id do LoteRps>"` |
   | `SubstituirNfse` | RPS + pedido + raiz com `URI="#<Id do SubstituicaoNfse>"` |
   | Operações `nfsc` | raiz, `URI=""` |

4. **Namespaces** — são do GissOnline, não da ABRASF: `http://www.giss.com.br/<schema>-v2_04.xsd`,
   com os tipos complexos em `.../tipos-v2_04.xsd`. Em serviços tomados a versão é `v1_00`.

## Armadilhas encontradas

Todas descobertas testando contra o serviço; valem como lista de conferência:

- **Assinar o lote inteiro não basta.** O manual diz que assinar o lote dispensa a assinatura
  individual dos RPS, mas o serviço devolve `E174 — RPS não assinado`. É preciso assinar cada RPS.
- **A assinatura do lote precisa usar `URI="#idDoLote"`.** Assinar o documento inteiro (`URI=""`)
  invalida as assinaturas dos RPS já aplicadas, e volta o `E174`.
- **Assinar onde o XSD não declara `Signature` derruba a requisição** com `E160 — arquivo em
  desacordo com o XML Schema`. É o caso de `ConsultarNfseServicoTomado`.
- **Formato de envio ≠ formato de resposta.** A consulta devolve `ItemListaServico` como `1.04`,
  mas o envio exige `01.04`; o `CodigoNbs` vem `1.1502.10.00` e vai `115021000` (máx. 9); o
  `finNFSe` volta `1` e só aceita `0`; o `cLocalidadeIncid` volta `1` e exige código IBGE.
- **`ConsultarServicoCompradoPorNumero` exige número e série declarados**, embora o XSD os marque
  como opcionais — sem eles o servidor responde HTTP 400.
- **O serviço `nfsc` devolve texto com dupla codificação** ("Nota nÃ£o encontrada"); o cliente
  detecta e corrige.
- **`tipos-servicos-comprados-v1_01.xsd` é um delta incompleto** (54 tipos contra 191 do v1_00) e
  não compila sozinho, apesar de ter o mesmo `targetNamespace`. Ver `docs/schemas-tomados/vigente/`.
- **Cuidado com `toISOString` em datas de competência**: à noite, no fuso de Brasília, ele adianta
  o dia e muda a competência da nota.

## Ambiente de homologação

O manual de Serviços Prestados v1.6 anuncia `ws-homologacao.giss.com.br`, mas esse host só serve o
portal Angular (`405` no POST). O ambiente SOAP que responde é o citado no manual de PIS/COFINS:

```
https://ws-homologacao-rtc.giss.com.br/service-ws/nf/nfse-ws
```

É o que `--env homologacao` usa. Duas limitações conhecidas nele:

- o CNPJ do prestador **não está cadastrado** — as operações param em `E361 — Empresa não
  localizada`, que é justamente o teto útil para testar schema e assinatura;
- o campo **`tpRetPisCofins` é rejeitado** com `E160`, embora conste do XSD publicado, do manual de
  PIS/COFINS e de notas reais emitidas em produção. Indica schema desatualizado nesse ambiente.
  O campo faz parte do perfil padrão; remova-o do `dados/perfil.json` para testar em homologação.

## Perfil fiscal

`src/storage/profile-repository.ts` guarda os valores que se repetem em toda emissão (item da LC 116, CNAE, NBS,
município, exigibilidade do ISS, PIS/COFINS, IBS/CBS). Os padrões vieram de uma NFS-e real já
aceita pela prefeitura, com os formatos corrigidos para envio. `npm run giss -- perfil --salvar`
grava em `dados/perfil.json` para edição.

**Confira com sua contabilidade antes de emitir** — os padrões refletem um prestador optante do
Simples Nacional, ISS não retido, serviço 01.04.

## Segurança

O que **nunca** entra no repositório (já coberto pelo `.gitignore`):

- `.env` — senha do certificado e credenciais do portal
- `cert/*` — o `.pfx` e os PEM exportados (a chave sai **sem senha**, modo `0600`)
- `dados/*` — cadastro local e perfil fiscal, com dados de terceiros

As duas pastas são versionadas vazias, via `.gitkeep`, e a regra ignora o
conteúdo (`cert/*`) em vez da pasta (`cert/`) — assim quem clona já sabe onde
pôr o certificado, sem risco de subir o arquivo junto.

Duas observações sobre o código:

- o `APP_ID` em `src/services/portal-service.ts` não é segredo — é constante pública do bundle do portal
  (`portal/js/app.js`), enviada por qualquer navegador que abra o site;
- a assinatura usa `rsa-sha1` e digest `sha1`. São algoritmos fracos pelos padrões atuais, mas é
  o que o serviço valida (manual, seção 6.3). Não troque sem confirmar com a prefeitura.

## Verificação

```bash
npm run typecheck                                  # tsc --noEmit
npm run giss -- cert                               # abre o .pfx e mostra validade
npm run giss -- prestado --inicio D --fim D        # consulta real, só leitura
npm run giss -- emitir --tomador X --valor 1       # dry-run + validação contra o XSD
```

O dry-run da emissão valida o XML assinado contra `gerar-nfse-envio-v2_04.xsd` e só imprime o
resultado — nada é enviado sem `--confirmar`.

## Documentação

Em `docs/`: manuais técnicos (Serviços Prestados v1.6, Serviços Tomados/CST v2.5,
PIS/COFINS/CSLL v1.0), schemas XSD, exemplos de XML e a planilha de erros e alertas.
Origem: <https://suzano.giss.com.br/giss-ajuda/desenvolvedores.html>.

`docs/schemas-tomados/vigente/` traz os XSD de serviços tomados com o `tipos` v1_01 mesclado sobre
o v1_00 — necessário porque o v1_01 publicado é um delta que não compila sozinho. Os arquivos
originais ficam intactos no diretório acima.

## Aviso

Projeto de uso interno, sem vínculo com a Eicon ou com o GissOnline. A API REST do portal é
interna e sem contrato público — pode mudar sem aviso. Emitir, cancelar ou substituir NFS-e produz
efeitos fiscais reais: confira os valores do perfil com sua contabilidade antes de usar
`--confirmar` em produção.
