# O erro que não dizia nada: depurando uma NFS-e por Web Service

*Como um `A01 — Não foi possível atender a solicitação` me fez escrever um chamado
acusando o fornecedor de um bug que era meu.*

---

Emitir nota fiscal de serviço por Web Service no Brasil é uma daquelas tarefas que
parecem simples até você tentar. Cada município escolhe um provedor, cada provedor
implementa o padrão ABRASF à sua maneira, e a documentação descreve um sistema
parecido — mas não idêntico — ao que responde do outro lado.

Este é o relato de dois dias integrando o GissOnline, o provedor usado por
centenas de prefeituras. O que aprendi sobre NFS-e cabe num README. O que aprendi
sobre depurar caixa-preta cabe aqui.

## O ponto de partida

As consultas funcionaram rápido. Certificado A1 no handshake mTLS, envelope SOAP,
assinatura XMLDSig, e as notas voltaram. Em algumas horas eu listava o histórico
inteiro por período, faixa de numeração e protocolo.

A emissão foi outra história.

```
GerarNfse retornou erro:
  [A01] Não foi possivel atender a solicitação
        Tente novamente mais tarde ou entre em contato com o atendimento.
```

Só isso. Sem campo, sem linha, sem pista.

## Primeiro instinto: mudar coisas

O instinto errado bate primeiro. Troquei o item de serviço. Troquei a competência.
Removi a alíquota. Tirei o grupo de IBS/CBS. Mandei pelo lote síncrono em vez da
emissão direta. Testei com outro cliente.

`A01` em todas.

Isso já deveria ter me dito algo — e disse, só que eu li errado. Concluí que "o
problema não está nos campos", quando a leitura correta seria "eu ainda não sei o
que estou variando".

## Segundo instinto: descartar o que dá para descartar

Aqui a coisa melhorou. Em vez de adivinhar a causa, fui provando o que **não**
era, usando o próprio serviço como oráculo.

**A assinatura estava certa?** Mandei uma requisição sem assinar. Voltou
`E174 — RPS não assinado`. Mandei com a assinatura no lugar errado: `E172 — erro
na assinatura`. Como nenhum dos meus testes produzia esses erros, a assinatura
estava sendo aceita.

**O XML batia com o schema?** Validei localmente contra o XSD oficial com
`xmllint`. E, para confirmar que o servidor também validava, mandei de propósito
um campo fora do formato: `E160 — arquivo em desacordo com o XML Schema`. Ou seja,
quando o XML está errado, ele sabe dizer.

**O certificado?** As consultas passavam pelo mesmo canal, com o mesmo
certificado.

Cada hipótese eliminada com o erro que *apareceria* se ela fosse a causa. Isso é
mais forte que "testei e não era".

## A conclusão errada

Sobrou a bisseção. Montei a mensagem mínima que o XSD exige e fui somando um
campo por vez.

O mínimo devolveu algo novo:

```
E202 — Código de tributação não informado
```

Um erro de negócio de verdade. O servidor tinha processado a requisição e apontado
o que faltava. Acrescentei o código de tributação — o mesmo que consta nas notas
já emitidas pelo portal:

```
A01
```

Testei todos os formatos: com máscara, sem máscara, oito dígitos, o id interno da
atividade, zero. `A01` em todos. Sem o campo, `E202` pedindo o campo.

A leitura parecia inescapável: **o campo é obrigatório para processar, mas
processá-lo quebra o serviço.** Um impasse do lado deles.

Escrevi o chamado. Identificação da empresa, endpoint, tabela com os nove testes,
a seção "o que já descartamos" com o erro esperado de cada hipótese, três
perguntas objetivas. Um chamado do qual eu me orgulhava.

E estava errado.

## A pergunta que mudou tudo

Antes de enviar, veio a pergunta certa:

> *"Mas cara, você realmente tem certeza que o problema é com eles?"*

Não tinha. E ao separar o que eu tinha provado do que eu tinha concluído, a
diferença apareceu:

- **Provado:** o `A01` aparece se e somente se aquele campo está presente.
- **Não provado:** que o valor que eu mandava estava correto.

Se o valor estivesse errado, o esperado seria `A1 — dados não constam do cadastro`,
que existe na tabela de erros deles. Mas nada impede um valor inválido de cair num
caminho sem tratamento e virar erro genérico.

O `A01` dizia onde travava. Não dizia de quem era a culpa.

## A virada

Faltava um método que eu não tinha tentado: o **lote assíncrono**.

O padrão ABRASF tem duas formas de emitir. A síncrona responde na hora. A
assíncrona devolve um protocolo, e você consulta o resultado depois.

Mandei a mesma nota pelo lote:

```
E383 — Código do país não informado
```

Uma mensagem específica. Onde o síncrono dizia `A01`, o assíncrono dizia o campo.

Acrescentei o país:

```
E310 — Código do município de incidência do ISSQN incorreto
```

Acrescentei o município:

```
Lote aceito. Protocolo: 3369xxx
```

E na consulta do protocolo:

```
E163 — Alíquota não informada para retenção do ISSQN no Simples Nacional
```

Informei a alíquota, 3,07%, exatamente como aparece na nota emitida pelo portal:

```
E165 — Alíquota do serviço inválida
```

Testei 3.07, 3.0700, 4.00, 2.00. Todas inválidas. Até que, testando formatos:

```
0.0307  →  aceito
```

**A alíquota vai como fração.** 3,07% se envia como `0.0307`. Mandar `3.07`
significa 307%, e o serviço recusa.

E o detalhe que fecha a armadilha: **a consulta devolve o percentual**. Você abre o
espelho de uma nota emitida, lê `<Aliquota>3.07</Aliquota>`, copia para o seu
request — e erra. O valor que sai não é o valor que entra.

## O placar

Três campos que eu omitia ou mandava errado. Nenhum bug do fornecedor. O chamado
teria queimado o tempo de um atendente e o meu.

Mas há uma crítica que se sustenta: **o `A01` não orienta ninguém.** O mesmo
sistema que respondeu `E383`, `E310`, `E163` e `E165` — mensagens boas, que apontam
o campo — escolheu dizer "não foi possível atender a solicitação" no caminho
síncrono. A informação existia. Só não chegava.

Uma nota curiosa: mesmo depois de acertar todos os campos, o `GerarNfse` continuou
respondendo `A01`. O mesmo payload que o lote aceita e converte em nota fiscal. Só
o assíncrono emite.

## O que eu levo disso

**Erro genérico é sintoma, não diagnóstico.** `A01`, `500`, "algo deu errado" —
dizem que a informação se perdeu no caminho, não onde está o problema.

**Prove o negativo com o erro que apareceria.** "Testei e não era" é fraco.
"Se fosse a assinatura, viria `E172`, e não veio" é forte. Faça o sistema provar
que valida aquilo antes de descartar.

**Tente outro caminho para o mesmo lugar.** Sistemas grandes têm mais de uma porta,
e elas raramente falham igual. O lote assíncrono virou minha ferramenta de
diagnóstico do endpoint síncrono — não porque eu queria usá-lo, mas porque ele
falava.

**Separe o que você provou do que você concluiu.** Eu tinha uma correlação sólida
(campo presente = erro) e transformei em causa (campo quebra o servidor). O passo
entre as duas coisas é onde mora quase todo diagnóstico errado.

**Formato de resposta não é formato de request.** A alíquota é o caso mais caro,
mas não o único que encontrei: o item da lista volta como `1.04` e vai como
`01.04`; o NBS volta com pontos e vai sem; um campo volta `1` e precisa ser enviado
como código IBGE de sete dígitos. A API não é simétrica, e presumir que é custa
horas.

**Antes de acusar, releia.** A pergunta "você tem certeza que o problema é deles?"
economizou um chamado errado e resolveu a integração no mesmo dia.

---

O cliente que saiu disso está publicado como
[`gissonline-nfse`](https://www.npmjs.com/package/gissonline-nfse) — MIT, com as
16 operações dos dois serviços SOAP, assinatura, validação contra os XSD e as
armadilhas todas documentadas no README. Se você vai integrar NFS-e com o
GissOnline, comece pelo lote assíncrono. Ele fala com você.
