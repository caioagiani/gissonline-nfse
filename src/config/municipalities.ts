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
}

export const MUNICIPALITIES: readonly Municipality[] = [
  { slug: "maceio", name: "Maceió", state: "AL", cityCode: "2704302" },
  { slug: "marechaldeodoro", name: "Marechal Deodoro", state: "AL", cityCode: "2704708" },
  { slug: "mineiros", name: "Mineiros", state: "GO", cityCode: "5213103" },
  { slug: "contagem", name: "Contagem", state: "MG", cityCode: "3118601" },
  { slug: "muriae", name: "Muriaé", state: "MG", cityCode: "3143906" },
  { slug: "caruaru", name: "Caruaru", state: "PE", cityCode: "2604106" },
  { slug: "paulista", name: "Paulista", state: "PE", cityCode: "2610707" },
  { slug: "umuarama", name: "Umuarama", state: "PR", cityCode: "4128104" },
  { slug: "bertioga", name: "Bertioga", state: "SP", cityCode: "3506359" },
  { slug: "capivari", name: "Capivari", state: "SP", cityCode: "3510401" },
  { slug: "diadema", name: "Diadema", state: "SP", cityCode: "3513801" },
  { slug: "embuguacu", name: "Embu-Guaçu", state: "SP", cityCode: "3515103" },
  { slug: "guararema", name: "Guararema", state: "SP", cityCode: "3518305" },
  { slug: "guaruja", name: "Guarujá", state: "SP", cityCode: "3518701" },
  { slug: "guarulhos", name: "Guarulhos", state: "SP", cityCode: "3518800" },
  { slug: "hortolandia", name: "Hortolândia", state: "SP", cityCode: "3519071" },
  { slug: "itu", name: "Itu", state: "SP", cityCode: "3523909" },
  { slug: "jaboticabal", name: "Jaboticabal", state: "SP", cityCode: "3524303" },
  { slug: "jardinopolis", name: "Jardinópolis", state: "SP", cityCode: "3525102" },
  { slug: "jundiai", name: "Jundiaí", state: "SP", cityCode: "3525904" },
  { slug: "maua", name: "Mauá", state: "SP", cityCode: "3529401" },
  { slug: "olimpia", name: "Olímpia", state: "SP", cityCode: "3533908" },
  { slug: "paulinia", name: "Paulínia", state: "SP", cityCode: "3536505" },
  { slug: "piedade", name: "Piedade", state: "SP", cityCode: "3537800" },
  { slug: "praiagrande", name: "Praia Grande", state: "SP", cityCode: "3541000" },
  { slug: "registro", name: "Registro", state: "SP", cityCode: "3542602" },
  { slug: "ribeiraopires", name: "Ribeirão Pires", state: "SP", cityCode: "3543303" },
  { slug: "rioclaro", name: "Rio Claro", state: "SP", cityCode: "3543907" },
  { slug: "salto", name: "Salto", state: "SP", cityCode: "3545209" },
  { slug: "santoandre", name: "Santo André", state: "SP", cityCode: "3547809" },
  { slug: "santos", name: "Santos", state: "SP", cityCode: "3548500" },
  { slug: "suzano", name: "Suzano", state: "SP", cityCode: "3552502" },
];

/** Busca um município conhecido pelo slug do host. */
export function findMunicipality(slug: string): Municipality | undefined {
  const wanted = slug.trim().toLowerCase();
  return MUNICIPALITIES.find((m) => m.slug === wanted);
}
