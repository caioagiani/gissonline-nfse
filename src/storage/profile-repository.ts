import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ApproximateTaxes,
  IbsCbs,
  PisCofins,
  Rps,
  ServiceTaker,
  YesNo,
} from "../domain/types.ts";

/**
 * Valores fiscais que se repetem em toda emissão do prestador. Os padrões abaixo
 * foram extraídos de uma NFS-e real já aceita pela prefeitura de Suzano
 * (competência 07/2026), com os formatos corrigidos para envio — servem de
 * ponto de partida, mas cada prestador deve conferir com sua contabilidade.
 */
export interface IssuingProfile {
  /** Item da lista da LC 116 */
  serviceListItem: string;
  cnaeCode?: string;
  municipalTaxCode?: string;
  nbsCode?: string;
  /** Código IBGE do município de prestação */
  cityCode: string;
  countryCode?: string;
  /** 1 = exigível, 2 = não incidência, 3 = isenção, 4 = exportação... */
  issTaxability: number;
  incidenceCityCode?: string;
  simplesNacionalOptant: YesNo;
  taxIncentive: YesNo;
  issWithheld: YesNo;
  /** 1 a 6 — ver `tsRegimeEspecialTributacao` */
  specialTaxRegime?: number;
  /** Série usada nos RPS */
  series: string;
  defaultDescription?: string;
  pisCofins?: PisCofins;
  approximateTaxes?: ApproximateTaxes;
  ibsCbs?: Omit<IbsCbs, "taxableAmount">;
}

export const DEFAULT_PROFILE: IssuingProfile = {
  // O envio exige dois dígitos no item da lista ("01.04"), enquanto a resposta
  // da consulta devolve "1.04". Mesma diferença no NBS: no envio vai sem pontos.
  serviceListItem: "01.04",
  cnaeCode: "6201501",
  municipalTaxCode: "6201501",
  nbsCode: "115021000",
  cityCode: "3552502",
  countryCode: "0076",
  issTaxability: 1,
  incidenceCityCode: "3552502",
  simplesNacionalOptant: 1,
  taxIncentive: 2,
  issWithheld: 2,
  series: "A",
  pisCofins: {
    cst: "08", // sem incidência da contribuição
    taxableAmount: 0,
    pisRate: 0,
    cofinsRate: 0,
    pisAmount: 0,
    cofinsAmount: 0,
    withholdingType: 0,
  },
  approximateTaxes: { simplesNacional: 0 },
  ibsCbs: {
    // finNFSe no envio só aceita 0 (NFS-e normal); a consulta devolve 1.
    purpose: 0,
    endConsumer: 0,
    operationIndicator: "100301",
    operationType: 1,
    governmentEntityType: 4,
    recipientIndicator: 0,
    cst: "000",
    taxClassification: "000001",
    // Código IBGE de 7 dígitos, não o índice devolvido na consulta.
    incidenceLocationCode: "3552502",
    reductionRate: 0,
  },
};

export class ProfileRepository {
  readonly path: string;

  constructor(path = "dados/perfil.json") {
    this.path = resolve(path);
  }

  load(): IssuingProfile {
    if (!existsSync(this.path)) return DEFAULT_PROFILE;
    const saved = JSON.parse(
      readFileSync(this.path, "utf8"),
    ) as Partial<IssuingProfile>;
    return { ...DEFAULT_PROFILE, ...saved };
  }

  save(profile: IssuingProfile): string {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(profile, null, 2)}\n`);
    return this.path;
  }
}

export interface IssueInput {
  taker: ServiceTaker;
  serviceAmount: number;
  description?: string;
  competenceDate?: Date | string;
  issueDate?: Date | string;
  /** Informe para emitir via RPS; ausente gera NFS-e direta */
  rpsNumber?: number | string;
  series?: string;
  rpsType?: 1 | 2 | 3;
  /** Retenções federais — a NT 007 pede o total agregado em `csll` */
  csll?: number;
  inss?: number;
  incomeTax?: number;
  otherWithholdings?: number;
  deductions?: number;
  unconditionalDiscount?: number;
  conditionalDiscount?: number;
  additionalInformation?: string;
  /** Sobrescreve campos do perfil nesta emissão */
  profile?: Partial<IssuingProfile>;
}

/** Compõe o RPS completo a partir do perfil e dos poucos dados que variam por nota. */
export function buildRps(base: IssuingProfile, input: IssueInput): Rps {
  const profile = { ...base, ...input.profile };
  const competenceDate = input.competenceDate ?? new Date();
  const description = input.description ?? profile.defaultDescription ?? "";

  if (!description) {
    throw new Error(
      "Informe a discriminação do serviço (ou defina defaultDescription no perfil)",
    );
  }

  return {
    identification: input.rpsNumber
      ? {
          number: input.rpsNumber,
          series: input.series ?? profile.series,
          type: input.rpsType ?? 1,
        }
      : undefined,
    issueDate: input.issueDate ?? new Date(),
    status: 1,
    competenceDate,
    service: {
      amounts: {
        services: input.serviceAmount,
        deductions: input.deductions ?? 0,
        pis: 0, // a NT 007 exige 0.00 nas tags antigas
        cofins: 0,
        inss: input.inss ?? 0,
        incomeTax: input.incomeTax ?? 0,
        csll: input.csll ?? 0,
        otherWithholdings: input.otherWithholdings ?? 0,
        totalTaxes: 0,
        unconditionalDiscount: input.unconditionalDiscount ?? 0,
        conditionalDiscount: input.conditionalDiscount ?? 0,
        pisCofins: profile.pisCofins,
        approximateTaxes: profile.approximateTaxes,
        ibsCbs: profile.ibsCbs
          ? { ...profile.ibsCbs, taxableAmount: input.serviceAmount }
          : undefined,
      },
      issWithheld: profile.issWithheld,
      serviceListItem: profile.serviceListItem,
      cnaeCode: profile.cnaeCode,
      municipalTaxCode: profile.municipalTaxCode,
      nbsCode: profile.nbsCode,
      description,
      cityCode: profile.cityCode,
      countryCode: profile.countryCode,
      issTaxability: profile.issTaxability,
      incidenceCityCode: profile.incidenceCityCode,
    },
    taker: input.taker,
    specialTaxRegime: profile.specialTaxRegime,
    simplesNacionalOptant: profile.simplesNacionalOptant,
    taxIncentive: profile.taxIncentive,
    additionalInformation: input.additionalInformation,
  };
}
