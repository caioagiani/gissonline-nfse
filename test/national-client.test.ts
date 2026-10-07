import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import { packXml, parseJson, unpackXml } from "../src/providers/nacional/national-client.ts";

describe("packXml / unpackXml", () => {
  it("compacta em gzip e base64, e volta ao mesmo texto", () => {
    const xml = '<?xml version="1.0"?><DPS>ção &amp; acentuação</DPS>';
    const packed = packXml(xml);
    assert.match(packed, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(gunzipSync(Buffer.from(packed, "base64")).toString("utf8"), xml);
    assert.equal(unpackXml(packed), xml);
  });
});

describe("parseJson", () => {
  const response = (body: string) => ({ status: 200, contentType: "", body: Buffer.from(body) });

  it("lê o corpo JSON", () => {
    assert.deepEqual(parseJson(response('{"a":1}')), { a: 1 });
  });

  it("devolve null para o HTML de erro do IIS", () => {
    assert.equal(parseJson(response("<!DOCTYPE html><title>404</title>")), null);
  });
});
