/**
 * Onde a assinatura XMLDSig entra em cada operação.
 *
 * Não há uma regra única: o schema de cada operação decide se aceita
 * `Signature`, em que elemento, e o que a `Reference` aponta. Errar isso não
 * devolve uma mensagem clara — vem `E160` (fora do schema), `E172` (assinatura
 * inválida) ou `E174` (não assinado). Modelar como estratégia deixa cada regra
 * explícita e testável, em vez de espalhada por condicionais no cliente.
 */

/** Alvo de uma assinatura: o que é referenciado e onde a tag é inserida. */
export interface SignatureTarget {
  /** XPath do elemento cujo digest é calculado. Padrão: raiz do documento. */
  referenceXPath?: string;
  /** Valor do atributo `Id` referenciado na URI. Sem ele, assina o documento inteiro. */
  id?: string;
  /** XPath do elemento que recebe a tag `Signature`. Padrão: o mesmo da referência. */
  targetXPath?: string;
}

/** Assinador injetado nas políticas — implementado em `infra/xml-signer`. */
export interface XmlSigner {
  sign(xml: string, target?: SignatureTarget): string;
}

export interface SignaturePolicy {
  /** Nome legível, usado em log e diagnóstico */
  readonly name: string;
  apply(xml: string, signer: XmlSigner): string;
}

/**
 * Não assina. Necessário em `ConsultarNfseServicoTomado`, cujo XSD não declara
 * o elemento `Signature` — assinar devolve `E160`.
 */
export const noSignature: SignaturePolicy = {
  name: "sem assinatura",
  apply: (xml) => xml,
};

/** Assina o documento inteiro (`URI=""`). Usado nas consultas e no serviço nfsc. */
export const rootSignature: SignaturePolicy = {
  name: "raiz (URI vazia)",
  apply: (xml, signer) => signer.sign(xml),
};

/**
 * Assina um elemento interno referenciando seu `Id`. É o caso de `GerarNfse`
 * (a `Signature` vai dentro de `Rps`) e de `CancelarNfse` (dentro de `Pedido`).
 */
export function elementSignature(
  target: Required<SignatureTarget>,
  name = "elemento referenciado",
): SignaturePolicy {
  return { name, apply: (xml, signer) => signer.sign(xml, target) };
}

const infDeclarationXPath = (id: string) =>
  `//*[local-name(.)='InfDeclaracaoPrestacaoServico'][@Id='${id}']`;
const rpsWrapperXPath = (id: string) =>
  `//*[local-name(.)='Rps'][*[@Id='${id}']]`;

/** Assinatura de um RPS: referencia o `InfDeclaracaoPrestacaoServico` e entra no `Rps`. */
export function rpsTarget(rpsId: string): Required<SignatureTarget> {
  return {
    referenceXPath: infDeclarationXPath(rpsId),
    id: rpsId,
    targetXPath: rpsWrapperXPath(rpsId),
  };
}

/** Assinatura do pedido de cancelamento: referencia o `InfPedidoCancelamento`. */
export function cancellationTarget(requestId: string): Required<SignatureTarget> {
  return {
    referenceXPath: "//*[local-name(.)='InfPedidoCancelamento']",
    id: requestId,
    targetXPath: "//*[local-name(.)='Pedido']",
  };
}

/**
 * Lote de RPS: uma assinatura por RPS **mais** a do lote.
 *
 * O manual afirma que assinar o lote dispensa as individuais, mas o serviço
 * devolve `E174` sem elas. E a assinatura do lote precisa referenciar o `Id` de
 * `LoteRps`: com `URI=""` o digest cobre o documento todo e invalida as
 * assinaturas dos RPS já aplicadas, trazendo o `E174` de volta.
 */
export function rpsBatchSignature(
  rpsIds: readonly string[],
  batchId: string,
): SignaturePolicy {
  return {
    name: `lote (${rpsIds.length} RPS + lote)`,
    apply(xml, signer) {
      const signed = rpsIds.reduce(
        (current, id) => signer.sign(current, rpsTarget(id)),
        xml,
      );
      return signer.sign(signed, {
        referenceXPath: "//*[local-name(.)='LoteRps']",
        id: batchId,
        targetXPath: "/*",
      });
    },
  };
}

/** Substituição: assina o RPS novo, o pedido de cancelamento e o envelope. */
export function replacementSignature(
  rpsId: string,
  requestId: string,
  replacementId: string,
): SignaturePolicy {
  return {
    name: "substituição (RPS + pedido + envelope)",
    apply(xml, signer) {
      const withRps = signer.sign(xml, rpsTarget(rpsId));
      const withRequest = signer.sign(withRps, cancellationTarget(requestId));
      return signer.sign(withRequest, {
        referenceXPath: "//*[local-name(.)='SubstituicaoNfse']",
        id: replacementId,
        targetXPath: "/*",
      });
    },
  };
}
