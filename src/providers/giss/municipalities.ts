/**
 * Municípios que publicam o Web Service do GissOnline.
 *
 * Levantado em 2026-08-18 resolvendo os 5.288 slugs de município do IBGE
 * contra \`ws-<slug>.giss.com.br\` e confirmando, em cada host que respondeu,
 * as 16 operações do índice \`/service-ws/\`. É um retrato: prefeituras entram
 * e saem, e a lista não é publicada por ninguém.
 *
 * Uma consulta assinada em Guarulhos, Santos e Santo André devolveu
 * \`E361 — Empresa não localizada\`, o que prova o caminho inteiro até o
 * cadastro: mTLS, envelope SOAP, assinatura e schema. **Não** prova que as
 * regras de emissão sejam as mesmas — alíquota, item da lista e campos
 * obrigatórios são configurados por prefeitura, e é aí que moram as
 * armadilhas. Antes de contar com um município novo, emita uma nota real.
 */
export interface Municipality {
  /** Trecho do host: \`ws-<slug>.giss.com.br\` */
  slug: string;
  name: string;
  state: string;
  /** Código IBGE de 7 dígitos, também o subdomínio do portal REST */
  cityCode: string;
  /**
   * `APP_ID` que o portal daquela cidade envia à API REST.
   *
   * Não é segredo — é constante do bundle `portal/js/app.js`, que qualquer
   * navegador baixa. Varia por cidade e não é 1:1: Guarujá, Maceió e Santo
   * André compartilham o mesmo, o que sugere um id por instância do portal,
   * não por município. Ausente onde o portal não respondeu (Contagem e Salto).
   */
  appId?: string;
}

export const MUNICIPALITIES: readonly Municipality[] = [
  {
    slug: "maceio",
    name: "Maceió",
    state: "AL",
    cityCode: "2704302",
    appId: "c7d920e2-7964-4f36-96ca-028eadb056c4",
  },
  {
    slug: "marechaldeodoro",
    name: "Marechal Deodoro",
    state: "AL",
    cityCode: "2704708",
    appId: "a22bce12-6c88-5c50-f545-1b095e400c9b",
  },
  {
    slug: "mineiros",
    name: "Mineiros",
    state: "GO",
    cityCode: "5213103",
    appId: "01a68326-4e3c-3760-5aff-8788026cf881",
  },
  { slug: "contagem", name: "Contagem", state: "MG", cityCode: "3118601" },
  {
    slug: "muriae",
    name: "Muriaé",
    state: "MG",
    cityCode: "3143906",
    appId: "3848aa27-6f6c-3b52-317c-d17009d9abfd",
  },
  {
    slug: "caruaru",
    name: "Caruaru",
    state: "PE",
    cityCode: "2604106",
    appId: "34962a72-9a7b-d36a-dddb-711bb243bdc3",
  },
  {
    slug: "paulista",
    name: "Paulista",
    state: "PE",
    cityCode: "2610707",
    appId: "a8270ebb-02e1-8c15-c985-ad3faa70df99",
  },
  {
    slug: "umuarama",
    name: "Umuarama",
    state: "PR",
    cityCode: "4128104",
    appId: "43703d69-106a-a620-60bf-2d7d72a518c8",
  },
  {
    slug: "bertioga",
    name: "Bertioga",
    state: "SP",
    cityCode: "3506359",
    appId: "353214f4-2a3a-3794-37f6-0068636e874f",
  },
  {
    slug: "capivari",
    name: "Capivari",
    state: "SP",
    cityCode: "3510401",
    appId: "79240c66-373e-3ad0-faa8-4e77dbd25491",
  },
  {
    slug: "diadema",
    name: "Diadema",
    state: "SP",
    cityCode: "3513801",
    appId: "d9d35829-84b2-14a4-212f-8f6cdb14c1f4",
  },
  {
    slug: "embuguacu",
    name: "Embu-Guaçu",
    state: "SP",
    cityCode: "3515103",
    appId: "763b2a3a-0607-2923-0af8-43980c9125ca",
  },
  {
    slug: "guararema",
    name: "Guararema",
    state: "SP",
    cityCode: "3518305",
    appId: "4463307a-d23f-4e95-ed37-5952955ae3a7",
  },
  {
    slug: "guaruja",
    name: "Guarujá",
    state: "SP",
    cityCode: "3518701",
    appId: "c7d920e2-7964-4f36-96ca-028eadb056c4",
  },
  {
    slug: "guarulhos",
    name: "Guarulhos",
    state: "SP",
    cityCode: "3518800",
    appId: "6d624ecd-527d-4296-a418-f77db493f503",
  },
  {
    slug: "hortolandia",
    name: "Hortolândia",
    state: "SP",
    cityCode: "3519071",
    appId: "ed3f22db-8eac-e861-85fb-fa25b7ef78cc",
  },
  {
    slug: "itu",
    name: "Itu",
    state: "SP",
    cityCode: "3523909",
    appId: "0912de22-9e6b-e859-7ed7-0d9ded6ac313",
  },
  {
    slug: "jaboticabal",
    name: "Jaboticabal",
    state: "SP",
    cityCode: "3524303",
    appId: "217c4e42-d30b-ffdf-cb18-7869f3fb3530",
  },
  {
    slug: "jardinopolis",
    name: "Jardinópolis",
    state: "SP",
    cityCode: "3525102",
    appId: "49b78ba3-bf87-d07d-807f-68ccab8b71a2",
  },
  {
    slug: "jundiai",
    name: "Jundiaí",
    state: "SP",
    cityCode: "3525904",
    appId: "1d1164ee-bcd3-e2eb-4d58-414a9bd6a90c",
  },
  {
    slug: "maua",
    name: "Mauá",
    state: "SP",
    cityCode: "3529401",
    appId: "a4bad24d-9923-f37d-e824-d1255ec49cef",
  },
  {
    slug: "olimpia",
    name: "Olímpia",
    state: "SP",
    cityCode: "3533908",
    appId: "642ba8a2-11f1-daed-d15f-08d8a21fc703",
  },
  {
    slug: "paulinia",
    name: "Paulínia",
    state: "SP",
    cityCode: "3536505",
    appId: "10b0bf31-9538-438e-57b0-756dd0edce7b",
  },
  {
    slug: "piedade",
    name: "Piedade",
    state: "SP",
    cityCode: "3537800",
    appId: "decc99ab-ae9d-44c2-f57d-bc40c9712232",
  },
  {
    slug: "praiagrande",
    name: "Praia Grande",
    state: "SP",
    cityCode: "3541000",
    appId: "f75e3e9f-e002-8e0f-ffb4-3c319a6e44fe",
  },
  {
    slug: "registro",
    name: "Registro",
    state: "SP",
    cityCode: "3542602",
    appId: "98201f5f-3aa7-d2a8-9b04-e72526033a65",
  },
  {
    slug: "ribeiraopires",
    name: "Ribeirão Pires",
    state: "SP",
    cityCode: "3543303",
    appId: "7a7d332a-0af6-35d1-8e27-8c1a12397234",
  },
  {
    slug: "rioclaro",
    name: "Rio Claro",
    state: "SP",
    cityCode: "3543907",
    appId: "6d663181-68c4-0cbf-e443-e5d1d0b34413",
  },
  { slug: "salto", name: "Salto", state: "SP", cityCode: "3545209" },
  {
    slug: "santoandre",
    name: "Santo André",
    state: "SP",
    cityCode: "3547809",
    appId: "c7d920e2-7964-4f36-96ca-028eadb056c4",
  },
  {
    slug: "santos",
    name: "Santos",
    state: "SP",
    cityCode: "3548500",
    appId: "526361eb-9f18-4e0c-b517-ecdaccd3511c",
  },
  {
    slug: "suzano",
    name: "Suzano",
    state: "SP",
    cityCode: "3552502",
    appId: "a320e7f8-a64b-7d39-44de-490fe85dc487",
  },
];

/** Busca um município conhecido pelo código IBGE — o subdomínio da API REST. */
export function findMunicipalityByCode(
  cityCode: string | number,
): Municipality | undefined {
  const wanted = String(cityCode).trim();
  return MUNICIPALITIES.find((m) => m.cityCode === wanted);
}

/** Busca um município conhecido pelo slug do host. */
export function findMunicipality(slug: string): Municipality | undefined {
  const wanted = slug.trim().toLowerCase();
  return MUNICIPALITIES.find((m) => m.slug === wanted);
}
