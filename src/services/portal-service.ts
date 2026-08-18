import { PortalError } from "../domain/errors.ts";
import type { Address } from "../domain/types.ts";
import { requestBinary, requestJson } from "../infra/http-client.ts";
import { digitsOnly } from "../infra/xml.ts";

/**
 * Cliente da API REST que o portal GissOnline usa por trás.
 *
 * É o único caminho para o cadastro de clientes e fornecedores: o Web Service
 * SOAP não expõe cadastro nenhum (lá os participantes viajam dentro da nota).
 *
 * Atenção: é uma API interna, sem contrato público — pode mudar sem aviso.
 * Autentica por CPF/senha do portal, não pelo certificado A1.
 */

/** Constante pública do bundle do portal (`portal/js/app.js`), não é segredo. */
const APP_ID = "a320e7f8-a64b-7d39-44de-490fe85dc487";

export interface PortalCredentials {
  /** CPF do usuário do portal */
  login: string;
  password: string;
  /** Código IBGE do município — é também o subdomínio da API */
  cityCode: string;
  /** CNPJ da empresa a selecionar; usa a primeira quando ausente */
  cnpj?: string;
}

export interface PortalSession {
  token: string;
  userCode: string;
  clientId: number;
  companyId: number;
  companyType: number;
  legalName: string;
}

/** 1 = cliente, 2 = fornecedor */
export type PartyRole = 1 | 2;

export interface PortalParty {
  id?: number;
  idCliente: number;
  idEmpresa: number;
  tipo: PartyRole;
  razaoSocial: string;
  nomeFantasia?: string;
  documento: string;
  /** 1 = CNPJ, 2 = CPF */
  tipoDocumento: 1 | 2;
  exterior: boolean;
  mei: boolean;
  simplesNacional: boolean;
  tipoEmpresa: number;
  ativo: boolean;
  /**
   * The backend only persists a record whose `alterado` is true — a PUT without
   * it answers 200 and silently changes nothing. Set by `update`.
   */
  alterado?: boolean;
  inscricaoMunicipal?: string;
  /**
   * Contact sits at the party root, and each field is an object — sending plain
   * strings answers HTTP 500. The shape comes from the portal's own form:
   * `dados.email.email`, `dados.telefone.codigoArea`, `dados.telefone.telefone`.
   */
  email?: { email: string; alterado?: boolean };
  telefone?: { codigoArea: string; telefone: string; alterado?: boolean };
  endereco?: PortalAddress;
}

export interface PortalAddress {
  idEndereco?: number;
  idCliente: number;
  alterado?: boolean;
  /** 2 = endereço comercial, como o portal grava */
  tipo: number;
  idIbge: number;
  /** Código IBGE da UF (os dois primeiros dígitos do município) */
  idUfIbge: number;
  tipoLogradouro: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cep: string;
  cidade: string;
  estado: string;
  /** 76 = Brasil */
  pais: number;
  ativo: boolean;
}

interface ApiResponse<T> {
  codigoHTTP: number;
  conteudo: T;
  mensagem?: string;
}

/** Formatos em que o portal entrega uma nota emitida. */
export type DocumentFormat = "pdf" | "xml";

export class PortalService {
  readonly base: string;
  #session: PortalSession;
  readonly #credentials: PortalCredentials;

  private constructor(
    base: string,
    session: PortalSession,
    credentials: PortalCredentials,
  ) {
    this.base = base;
    this.#session = session;
    this.#credentials = credentials;
  }

  get session(): PortalSession {
    return this.#session;
  }

  /** Quando o token expira, em horário local. */
  get expiresAt(): Date {
    const payload = this.#session.token.split(".")[1] ?? "";
    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { exp: number };
    return new Date(exp * 1000);
  }

  /**
   * Autentica em três passos, como o portal faz:
   * 1. usuário/senha devolve um token sem empresa;
   * 2. `login/permissao` lista as empresas vinculadas;
   * 3. o token é trocado por outro já vinculado à empresa escolhida.
   */
  static async authenticate(
    credentials: PortalCredentials,
  ): Promise<PortalService> {
    const base = `https://${credentials.cityCode}.giss.com.br`;

    const initial = await requestJson<{
      access_token: string;
      codigo_usuario: string;
    }>(base, "/service-empresa/api/login/token", {
      method: "POST",
      headers: {
        APP_ID,
        PARAM_USER: "CodCliente",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: digitsOnly(credentials.login),
        password: credentials.password,
        tipoLogin: "0",
        idParametroInicial: "2",
      }).toString(),
    });

    const permissions = await requestJson<{
      conteudo: {
        codigoUsuario: string;
        empresas: Array<{
          documento: string;
          razaoSocial: string;
          inscricaoMunicipal: string;
          idEmpresa: number;
          idCliente: number;
          clienteReferencia: string;
          tipoEmpresa: number;
        }>;
      };
    }>(base, "/service-empresa/api/login/permissao", {
      headers: { Authorization: `Bearer ${initial.access_token}` },
    });

    const companies = permissions.conteudo.empresas;
    const target = credentials.cnpj
      ? companies.find((c) => c.documento === digitsOnly(credentials.cnpj!))
      : companies[0];
    if (!target) {
      throw new Error(
        `Empresa ${credentials.cnpj ?? ""} não encontrada. Disponíveis: ` +
          companies.map((c) => `${c.documento} (${c.razaoSocial})`).join(", "),
      );
    }

    const final = await requestJson<{ access_token: string }>(
      base,
      "/service-empresa/api/login/token",
      {
        method: "POST",
        headers: {
          APP_ID,
          PARAM_USER: "CodCliente",
          PARAM_LOGIN: target.clienteReferencia,
          CODIGO_USUARIO: initial.codigo_usuario,
          PARAM_PRIV: `empresa=${target.idEmpresa}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: initial.access_token,
        }).toString(),
      },
    );

    return new PortalService(
      base,
      {
        token: final.access_token,
        userCode: initial.codigo_usuario,
        clientId: target.idCliente,
        companyId: target.idEmpresa,
        companyType: target.tipoEmpresa,
        legalName: target.razaoSocial,
      },
      credentials,
    );
  }

  /** Refaz o login e substitui a sessão em uso. */
  async renew(): Promise<PortalSession> {
    const fresh = await PortalService.authenticate(this.#credentials);
    this.#session = fresh.session;
    return this.#session;
  }

  /**
   * Resolve o nome do município a partir do código IBGE — o cadastro grava o
   * nome (`"SAO PAULO"`), não o código. A listagem é por UF, que são os dois
   * primeiros dígitos do código do município.
   */
  async cityName(cityCode: string | number): Promise<string> {
    const code = Number(cityCode);
    const state = String(code).slice(0, 2);
    const response = await this.call<
      ApiResponse<Array<{ idMunicipioIbge: number; municipio: string }>>
    >(`/service-objetos-compartilhados/api/municipio-ibge/listar/${state}`);

    const city = response.conteudo.find((c) => c.idMunicipioIbge === code);
    if (!city) throw new Error(`Município ${cityCode} não encontrado na UF ${state}`);
    return city.municipio;
  }

  /**
   * Lista os clientes (papel 1) ou fornecedores (papel 2) cadastrados.
   *
   * O último segmento da rota é o **tipo da empresa logada**, não o papel do
   * participante — passar o papel ali devolve HTTP 500. O papel vem no campo
   * `tipo` de cada registro, então a separação é feita aqui.
   */
  async list(role?: PartyRole): Promise<PortalParty[]> {
    const { clientId, companyId, companyType } = this.#session;
    const response = await this.call<ApiResponse<PortalParty[]>>(
      `/service-empresa/api/cliente-fornecedor/cliente/${clientId}/empresa/${companyId}/tipo/${companyType}`,
    );
    const parties = response.conteudo ?? [];
    return role === undefined ? parties : parties.filter((p) => p.tipo === role);
  }

  /** Busca um participante pelo id interno, com endereço. */
  async get(id: number): Promise<PortalParty> {
    const response = await this.call<ApiResponse<PortalParty>>(
      `/service-empresa/api/cliente-fornecedor/${this.#session.clientId}/${id}`,
    );
    return response.conteudo;
  }

  /** Procura por CPF/CNPJ entre os já cadastrados. Sem `role`, busca em ambos. */
  async findByTaxId(
    taxId: string,
    role?: PartyRole,
  ): Promise<PortalParty | undefined> {
    const digits = digitsOnly(taxId);
    const parties = await this.list(role);
    return parties.find((p) => p.documento === digits);
  }

  /** Cadastra um cliente ou fornecedor. */
  async create(party: PortalParty): Promise<PortalParty> {
    const response = await this.call<ApiResponse<PortalParty>>(
      "/service-empresa/api/cliente-fornecedor/",
      { method: "POST", body: JSON.stringify(party) },
    );
    return response.conteudo;
  }

  /**
   * Atualiza um cadastro existente (exige o `id`).
   *
   * Marca `alterado` no participante e nos grupos aninhados: sem isso o serviço
   * responde 200 e não grava nada, que é como o portal distingue o que mudou.
   */
  async update(party: PortalParty): Promise<PortalParty> {
    if (!party.id) throw new Error("Informe o id do cadastro a atualizar");

    const body: PortalParty = {
      ...party,
      alterado: true,
      ...(party.endereco ? { endereco: { ...party.endereco, alterado: true } } : {}),
      ...(party.email ? { email: { ...party.email, alterado: true } } : {}),
      ...(party.telefone ? { telefone: { ...party.telefone, alterado: true } } : {}),
    };

    const response = await this.call<ApiResponse<PortalParty>>(
      "/service-empresa/api/cliente-fornecedor/",
      { method: "PUT", body: JSON.stringify(body) },
    );
    return response.conteudo;
  }

  /** Remove um cadastro (o portal chama de "anular"). */
  async remove(party: PortalParty): Promise<void> {
    await this.call("/service-empresa/api/cliente-fornecedor/anula", {
      method: "PUT",
      body: JSON.stringify({ ...party, ativo: false }),
    });
  }

  /**
   * Baixa uma nota emitida, em PDF (a representação impressa) ou XML (o
   * `CompNfse` que o serviço gravou).
   *
   * O identificador é o interno da nota — o atributo `Id` de `InfNfse` na
   * resposta da consulta —, não o número impresso no documento. Nenhum dos dois
   * Web Services gera arquivo: o ABRASF devolve o XML embutido na resposta
   * SOAP, então esta é a via para obtê-los prontos.
   */
  async invoiceDocument(
    internalId: number | string,
    format: DocumentFormat = "pdf",
  ): Promise<Buffer> {
    return this.withSession((headers) =>
      requestBinary(
        this.base,
        `/service-relatorio/api/relatorio/${format}/${this.#session.clientId}/nota/${internalId}`,
        { headers },
        `application/${format}`,
      ),
    );
  }

  /** Chamada JSON autenticada. */
  private async call<T>(route: string, init: RequestInit = {}): Promise<T> {
    return this.withSession((headers) =>
      requestJson<T>(this.base, route, {
        ...init,
        headers: { ...headers, ...init.headers },
      }),
    );
  }

  /**
   * O token dura cerca de 8 horas. Se expirar no meio de um processo longo, a
   * API responde 401/403 — aqui refazemos o login uma vez e repetimos a
   * chamada, para que quem usa a classe não precise tratar sessão. Os
   * cabeçalhos chegam montados ao chamador, que só escolhe o transporte: JSON
   * ou binário.
   */
  private async withSession<T>(
    send: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const headers = (): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.#session.token}`,
    });

    try {
      return await send(headers());
    } catch (error) {
      const expired =
        error instanceof PortalError &&
        (error.status === 401 || error.status === 403);
      if (!expired) throw error;
      await this.renew();
      return send(headers());
    }
  }
}

/** Splits the area code from the number, the way the portal expects. */
function splitPhone(
  phone?: string,
): { codigoArea: string; telefone: string } | undefined {
  const digits = phone ? digitsOnly(phone) : "";
  if (digits.length < 10) return undefined;
  // drop the country code when present (55 + area + number)
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  return { codigoArea: local.slice(0, 2), telefone: local.slice(2) };
}

/** Monta o corpo de um participante a partir de dados soltos. */
export function buildPortalParty(
  session: PortalSession,
  data: {
    taxId: string;
    legalName: string;
    tradeName?: string;
    municipalRegistration?: string;
    role?: PartyRole;
    mei?: boolean;
    simplesNacional?: boolean;
    email?: string;
    phone?: string;
    address?: Address & { streetType?: string; cityName?: string };
  },
): PortalParty {
  const taxId = digitsOnly(data.taxId);
  const address = data.address;

  return {
    idCliente: session.clientId,
    idEmpresa: session.companyId,
    tipo: data.role ?? 1,
    razaoSocial: data.legalName,
    nomeFantasia: data.tradeName,
    documento: taxId,
    tipoDocumento: taxId.length > 11 ? 1 : 2,
    exterior: false,
    mei: data.mei ?? false,
    simplesNacional: data.simplesNacional ?? false,
    tipoEmpresa: session.companyType,
    ativo: true,
    inscricaoMunicipal: data.municipalRegistration,
    email: data.email ? { email: data.email } : undefined,
    telefone: splitPhone(data.phone),
    endereco: address
      ? {
          idCliente: session.clientId,
          tipo: 2,
          idIbge: Number(address.cityCode),
          // A UF é o prefixo de dois dígitos do código do município.
          idUfIbge: Number(String(address.cityCode).slice(0, 2)),
          tipoLogradouro: address.streetType ?? "Rua",
          logradouro: address.street,
          numero: address.number,
          complemento: address.complement,
          bairro: address.district,
          cep: digitsOnly(address.zipCode),
          cidade: address.cityName ?? "",
          estado: address.state,
          pais: 76,
          ativo: true,
        }
      : undefined,
  };
}
