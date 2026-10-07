import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ValidationError } from "../src/domain/errors.ts";
import { parseQueryResult } from "../src/providers/giss/messages/parser.ts";
import { ContactRepository, taxIdOf } from "../src/storage/contact-repository.ts";
import { syncFromInvoices } from "../src/storage/invoice-sync.ts";
import { DEFAULT_PROFILE, ProfileRepository, buildRps } from "../src/storage/profile-repository.ts";
import { responses } from "./giss-fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "nfse-br-storage-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(dir, `c${++n}`, "contacts.json");

describe("ContactRepository", () => {
  it("grava, normaliza o documento e relê do disco", () => {
    const path = fresh();
    const repo = new ContactRepository(path);
    const saved = repo.save("customer", { taxId: "52.884.617/0001-10", legalName: "Cliente Ltda", alias: "cli" });
    assert.equal(saved.taxId, "52884617000110");
    assert.equal(saved.source, "manual");
    const reloaded = new ContactRepository(path);
    assert.equal(reloaded.list("customer").length, 1);
    assert.equal(reloaded.list("supplier").length, 0);
  });

  it("busca por documento, apelido e trecho do nome", () => {
    const repo = new ContactRepository(fresh());
    repo.save("customer", { taxId: "52884617000110", legalName: "Cliente Ltda", alias: "cli" });
    assert.equal(repo.find("customer", "52.884.617/0001-10")?.legalName, "Cliente Ltda");
    assert.equal(repo.find("customer", "CLI")?.taxId, "52884617000110");
    assert.equal(repo.find("customer", "ente lt")?.taxId, "52884617000110");
    assert.equal(repo.find("supplier", "cli"), undefined);
  });

  it("atualizar preserva o que não veio", () => {
    const repo = new ContactRepository(fresh());
    repo.save("customer", { taxId: "52884617000110", legalName: "Cliente", email: "a@b.com" });
    const updated = repo.save("customer", { taxId: "52884617000110", legalName: "", phone: "11999" });
    assert.equal(updated.legalName, "Cliente");
    assert.equal(updated.email, "a@b.com");
    assert.equal(updated.phone, "11999");
    assert.equal(repo.list("customer").length, 1);
  });

  it("recusa sem documento ou sem razão social", () => {
    const repo = new ContactRepository(fresh());
    assert.throws(() => repo.save("customer", { taxId: "", legalName: "X" }), ValidationError);
    assert.throws(() => repo.save("customer", { taxId: "123", legalName: "" }), ValidationError);
  });

  it("remove pelo documento", () => {
    const repo = new ContactRepository(fresh());
    repo.save("supplier", { taxId: "12345678901", legalName: "Pessoa" });
    assert.equal(repo.remove("supplier", "123.456.789-01"), true);
    assert.equal(repo.remove("supplier", "123.456.789-01"), false);
  });

  it("ordena pela razão social em pt-BR", () => {
    const repo = new ContactRepository(fresh());
    repo.save("customer", { taxId: "1", legalName: "Ótica" });
    repo.save("customer", { taxId: "2", legalName: "Abacaxi" });
    repo.save("customer", { taxId: "3", legalName: "Padaria" });
    assert.deepEqual(repo.list("customer").map((c) => c.legalName), ["Abacaxi", "Ótica", "Padaria"]);
  });

  it("arquivo antigo sem uma das listas continua abrindo", () => {
    const path = fresh();
    new ContactRepository(path).save("customer", { taxId: "1", legalName: "A" });
    writeFileSync(path, JSON.stringify({ customers: [] }));
    assert.deepEqual(new ContactRepository(path).list("supplier"), []);
  });

  it("CPF e CNPJ pelo tamanho; contato só quando há e-mail ou telefone", () => {
    assert.deepEqual(taxIdOf("123.456.789-01"), { cpf: "12345678901" });
    assert.deepEqual(taxIdOf("52884617000110"), { cnpj: "52884617000110" });
    const base = { taxId: "52884617000110", legalName: "X", updatedAt: "", source: "manual" };
    assert.equal(ContactRepository.asServiceTaker(base).contact, undefined);
    assert.deepEqual(ContactRepository.asSupplier({ ...base, email: "e@x.com" }).contact, {
      email: "e@x.com",
      phone: undefined,
    });
  });
});

describe("syncFromInvoices", () => {
  it("cadastra os tomadores das notas, sem duplicar", () => {
    const repo = new ContactRepository(fresh());
    const { invoices } = parseQueryResult(
      responses.query("R", [
        { number: "1", takerCnpj: "52884617000110", takerName: "Cliente A" },
        { number: "2", takerCnpj: "52884617000110", takerName: "Cliente A" },
        { number: "3", takerCnpj: "11222333000181", takerName: "Cliente B" },
      ]),
    );
    const result = syncFromInvoices(repo, "customer", invoices);
    assert.equal(result.saved, 2);
    const a = repo.find("customer", "52884617000110")!;
    assert.equal(a.email, "fin@cliente.com.br");
    assert.equal(a.source, "NFS-e 2");
    assert.deepEqual(a.address, {
      street: "Rua das Flores",
      number: "100",
      complement: undefined,
      district: "Centro",
      cityCode: "3552502",
      state: "SP",
      zipCode: "08675000",
    });
  });

  it("fornecedor sai do PrestadorServico (notas de serviço tomado)", () => {
    const repo = new ContactRepository(fresh());
    const { invoices } = parseQueryResult(responses.query("R", [{ number: "1" }]));
    assert.deepEqual(syncFromInvoices(repo, "supplier", invoices).taxIds, ["37969249000110"]);
    assert.equal(repo.find("supplier", "37969249000110")?.municipalRegistration, "53624");
  });

  it("nota sem o grupo pedido é ignorada", () => {
    const repo = new ContactRepository(fresh());
    const { invoices } = parseQueryResult(`<R xmlns="x"><CompNfse><Nfse><InfNfse><Numero>1</Numero></InfNfse></Nfse></CompNfse></R>`);
    assert.equal(syncFromInvoices(repo, "customer", invoices).saved, 0);
  });
});

describe("perfil e buildRps", () => {
  const taker = { cnpj: "52884617000110", legalName: "Cliente" };

  it("sem arquivo usa o padrão; com arquivo, mescla", () => {
    const path = join(dir, "profile", "profile.json");
    const repo = new ProfileRepository(path);
    assert.equal(repo.load(), DEFAULT_PROFILE);
    repo.save({ ...DEFAULT_PROFILE, rate: 2.5, series: "B" });
    const loaded = repo.load();
    assert.equal(loaded.rate, 2.5);
    assert.equal(loaded.series, "B");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).series, "B");
  });

  it("sem discriminação recusa", () => {
    assert.throws(() => buildRps(DEFAULT_PROFILE, { taker, serviceAmount: 100, rate: 2 }), /discriminação/);
  });

  it("ISS exigível sem alíquota recusa nomeando o E163", () => {
    assert.throws(() => buildRps(DEFAULT_PROFILE, { taker, serviceAmount: 100, description: "x" }), /E163/);
    // não exigível dispensa
    assert.doesNotThrow(() =>
      buildRps({ ...DEFAULT_PROFILE, issTaxability: 3 }, { taker, serviceAmount: 100, description: "x" }),
    );
  });

  it("com número vira RPS; sem número, NFS-e direta", () => {
    const direct = buildRps(DEFAULT_PROFILE, { taker, serviceAmount: 100, description: "x", rate: 2 });
    assert.equal(direct.identification, undefined);
    const rps = buildRps(DEFAULT_PROFILE, { taker, serviceAmount: 100, description: "x", rate: 2, rpsNumber: 7 });
    assert.deepEqual(rps.identification, { number: 7, series: "A", type: 1 });
  });

  it("base do IBS/CBS acompanha o valor; perfil da nota sobrepõe o salvo", () => {
    const rps = buildRps(DEFAULT_PROFILE, {
      taker,
      serviceAmount: 1234.56,
      description: "x",
      rate: 2,
      csll: 10,
      profile: { serviceListItem: "01.07" },
    });
    assert.equal(rps.service.amounts.ibsCbs?.taxableAmount, 1234.56);
    assert.equal(rps.service.amounts.csll, 10);
    assert.equal(rps.service.amounts.pis, 0);
    assert.equal(rps.service.serviceListItem, "01.07");
  });
});
