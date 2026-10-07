import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateNfseRequest } from "../src/providers/giss/messages/provided-services.ts";
import { PROVIDER_CNPJ, sampleRps } from "./helpers.ts";

const provider = { cnpj: PROVIDER_CNPJ, municipalRegistration: "53624" };

describe("GerarNfse — OutrasRetencoes", () => {
  it("fica de fora quando zerada: Suzano recusa a tag com E370", () => {
    const xml = generateNfseRequest(sampleRps(), provider, "2.04");
    assert.doesNotMatch(xml, /OutrasRetencoes/);
    // os vizinhos obrigatórios continuam lá
    assert.match(xml, /ValorCsll>0\.00</);
    assert.match(xml, /ValTotTributos>0\.00</);
  });

  it("vai quando há valor", () => {
    const xml = generateNfseRequest(sampleRps({ otherWithholdings: 12.5 }), provider, "2.04");
    assert.match(xml, /OutrasRetencoes>12\.50</);
  });
});
