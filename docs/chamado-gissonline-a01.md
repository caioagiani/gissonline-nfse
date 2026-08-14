# Chamado GissOnline — GerarNfse retorna A01 quando CodigoTributacaoMunicipio é informado

## Identificação

| | |
| --- | --- |
| Município | Suzano/SP (IBGE 3552502) |
| Prestador | C.H. AGIANI PIMENTA |
| CNPJ | 37.969.249/0001-10 |
| Inscrição Municipal | 53624 |
| Endpoint | `https://ws-suzano.giss.com.br/service-ws/nf/nfse-ws` |
| Operações | `GerarNfse` e `RecepcionarLoteRpsSincrono` |
| Leiaute | ABRASF 2.04 (`versaoDados` 2.04) |
| Data dos testes | 14/08/2026 |

## Resumo

A emissão de NFS-e por Web Service falha com **`A01 — Não foi possível atender a
solicitação`** sempre que o campo `CodigoTributacaoMunicipio` é enviado, qualquer
que seja o valor. Quando o campo é omitido, o serviço responde
**`E202 — Código de tributação não informado`**, exigindo o mesmo campo.

O resultado é um impasse: o campo é obrigatório para o processamento, mas a sua
presença interrompe o processamento com erro genérico.

As **consultas** pelo mesmo endpoint, mesmo certificado e mesma assinatura
funcionam normalmente (`ConsultarNfseServicoPrestado`, `ConsultarNfsePorFaixa`,
`ConsultarLoteRps`, `ConsultarNfsePorRps`). O problema é exclusivo da emissão.

## Evidência

Envio incremental, do mínimo exigido pelo XSD para cima, mesma mensagem em todos
os casos exceto pelo campo indicado:

| # | Envio | Retorno |
| --- | --- | --- |
| 1 | mínimo do XSD, **sem** `CodigoTributacaoMunicipio` | `E202 — Código de tributação não informado` |
| 2 | apenas `CodigoCnae = 6319400` | `E202 — Código de tributação não informado` |
| 3 | `CodigoTributacaoMunicipio = 6319400` | **`A01`** |
| 4 | `CodigoTributacaoMunicipio = 63194000` | **`A01`** |
| 5 | `CodigoTributacaoMunicipio = 6319-4/00` | **`A01`** |
| 6 | `CodigoTributacaoMunicipio = 6319` / `631940` / `0` | **`A01`** |
| 7 | `CodigoTributacaoMunicipio = 1437` (id da atividade) | **`A01`** |
| 8 | item `01.04` + `CodigoTributacaoMunicipio = 6201501` | **`A01`** |
| 9 | item `01.04` **sem** `CodigoTributacaoMunicipio` | `E202` |

O comportamento se repete com os dois itens de serviço habilitados para a
empresa (`01.09` e `01.04`), com e sem os grupos `trib`, `IBSCBS` e `CodigoNbs`,
com competência corrente e retroativa, e também em `RecepcionarLoteRpsSincrono`.

O código de tributação usado nos testes (`6319400`) é o mesmo que consta nas
NFS-e emitidas pela empresa pelo portal — por exemplo a **NFS-e 570**, de
14/08/2026, e a **NFS-e 566**, de 17/07/2026.

## Descarte de outras causas

- **Assinatura digital** — validada: quando ausente ou incorreta, o serviço
  responde `E174`/`E172`. Nenhum dos casos acima produziu esses erros.
- **Schema** — validado: o XML é conferido localmente contra
  `gerar-nfse-envio-v2_04.xsd` com `xmllint`, e desvios reais produzem `E160`
  (confirmado ao enviar `cLocalidadeIncid = 1`, que o serviço recusa).
- **Certificado / mTLS** — certificado A1 ICP-Brasil válido até 17/04/2027,
  aceito no handshake; as consultas pelo mesmo canal funcionam.
- **Regras de negócio anteriores ao campo** — o serviço chega a avaliá-las: o
  caso 1 devolve `E202`, que é validação de negócio, não de transporte.

## Perguntas

1. O CNPJ 37.969.249/0001-10 está habilitado para **emissão** de NFS-e por Web
   Service em Suzano, ou apenas para consulta?
2. Qual o valor esperado em `CodigoTributacaoMunicipio` para as atividades
   habilitadas desta empresa (`01.09 / 6319400` e `01.04 / 6201501`)?
3. O `A01` corresponde a qual falha no processamento? A mensagem não permite
   correção pelo integrador.

## Contato técnico

Integração desenvolvida internamente, em Node.js, seguindo o Manual Técnico de
Serviços Prestados v1.6 e o Manual Técnico PIS/COFINS/CSLL v1.0. Podemos
fornecer o XML completo de qualquer um dos casos acima, com a assinatura, se
ajudar na análise.
