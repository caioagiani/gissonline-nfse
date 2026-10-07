import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MUNICIPALITIES,
  findMunicipality,
  findMunicipalityByCode,
} from "../src/providers/giss/municipalities.ts";

test("a lista não tem slug nem código IBGE repetido", () => {
  const slugs = MUNICIPALITIES.map((m) => m.slug);
  const codes = MUNICIPALITIES.map((m) => m.cityCode);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(codes).size, codes.length);
});

test("slug cabe no host e código IBGE tem 7 dígitos com a UF certa", () => {
  const ufCodes: Record<string, string> = { AL: "27", GO: "52", MG: "31", PR: "41", RJ: "33", SP: "35", SC: "42", RS: "43", BA: "29", PE: "26", ES: "32", MS: "50", MT: "51", DF: "53", CE: "23", PA: "15" };
  for (const m of MUNICIPALITIES) {
    assert.match(m.slug, /^[a-z0-9]+$/, m.slug);
    assert.match(m.cityCode, /^\d{7}$/, m.slug);
    if (ufCodes[m.state]) assert.equal(m.cityCode.slice(0, 2), ufCodes[m.state], m.slug);
    if (m.appId) assert.match(m.appId, /^[0-9a-f-]{36}$/, m.slug);
  }
});

test("busca por slug e por código", () => {
  assert.equal(findMunicipality(" SUZANO ")?.cityCode, "3552502");
  assert.equal(findMunicipalityByCode(3552502)?.slug, "suzano");
  assert.equal(findMunicipality("nada"), undefined);
});
