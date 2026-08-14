import type { Endereco } from "./types.ts";
import { somenteDigitos } from "./xml.ts";

/**
 * Cliente da API REST que o portal GissOnline usa por trás.
 *
 * É o único caminho para o cadastro de clientes e fornecedores: o Web Service
 * SOAP não expõe cadastro nenhum (lá os participantes viajam dentro da nota).
 *
 * Atenção: é uma API interna, sem contrato público — pode mudar sem aviso.
 * Autentica por CPF/senha do portal, não pelo certificado A1.
 */

const APP_ID = "a320e7f8-a64b-7d39-44de-490fe85dc487";

export interface CredenciaisPortal {
  /** CPF do usuário do portal */
  login: string;
  senha: string;
  /** Código IBGE do município — é também o subdomínio da API */
  codigoMunicipio: string;
  /** CNPJ da empresa a selecionar; usa a primeira quando ausente */
  cnpj?: string;
}

export interface Sessao {
  token: string;
  codigoUsuario: string;
  idCliente: number;
  idEmpresa: number;
  tipoEmpresa: number;
  razaoSocial: string;
}

/** 1 = cliente, 2 = fornecedor */
export type TipoParticipante = 1 | 2;

export interface ParticipantePortal {
  id?: number;
  idCliente: number;
  idEmpresa: number;
  tipo: TipoParticipante;
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
  inscricaoMunicipal?: string;
  endereco?: EnderecoPortal;
}

export interface EnderecoPortal {
  idEndereco?: number;
  idCliente: number;
  /** 2 = endereço comercial, como o portal grava */
  tipo: number;
  /** Código IBGE do município */
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

interface RespostaApi<T> {
  codigoHTTP: number;
  conteudo: T;
  mensagem?: string;
  erro?: unknown;
}

export class PortalError extends Error {
  readonly status: number;
  readonly corpo: unknown;

  constructor(rota: string, status: number, corpo: unknown) {
    const detalhe =
      typeof corpo === "object" && corpo !== null && "mensagem" in corpo
        ? String((corpo as { mensagem: unknown }).mensagem)
        : JSON.stringify(corpo).slice(0, 300);
    super(`${rota} → HTTP ${status}: ${detalhe}`);
    this.name = "PortalError";
    this.status = status;
    this.corpo = corpo;
  }
}

export class PortalClient {
  readonly base: string;
  #sessao: Sessao;
  readonly #credenciais: CredenciaisPortal;

  private constructor(
    base: string,
    sessao: Sessao,
    credenciais: CredenciaisPortal,
  ) {
    this.base = base;
    this.#sessao = sessao;
    this.#credenciais = credenciais;
  }

  get sessao(): Sessao {
    return this.#sessao;
  }

  /** Quando o token expira, em horário local. */
  get expiraEm(): Date {
    const payload = this.#sessao.token.split(".")[1] ?? "";
    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { exp: number };
    return new Date(exp * 1000);
  }

  /** Refaz o login e substitui a sessão em uso. */
  async renovar(): Promise<Sessao> {
    const novo = await PortalClient.autenticar(this.#credenciais);
    this.#sessao = novo.sessao;
    return this.#sessao;
  }

  /**
   * Autentica em três passos, como o portal faz:
   * 1. usuário/senha devolve um token sem empresa;
   * 2. `login/permissao` lista as empresas vinculadas;
   * 3. o token é trocado por outro já vinculado à empresa escolhida.
   */
  static async autenticar(credenciais: CredenciaisPortal): Promise<PortalClient> {
    const base = `https://${credenciais.codigoMunicipio}.giss.com.br`;

    const inicial = await requisicao<{
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
        username: somenteDigitos(credenciais.login),
        password: credenciais.senha,
        tipoLogin: "0",
        idParametroInicial: "2",
      }).toString(),
    });

    const permissao = await requisicao<{
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
      headers: { Authorization: `Bearer ${inicial.access_token}` },
    });

    const empresas = permissao.conteudo.empresas;
    const alvo = credenciais.cnpj
      ? empresas.find((e) => e.documento === somenteDigitos(credenciais.cnpj!))
      : empresas[0];
    if (!alvo) {
      throw new Error(
        `Empresa ${credenciais.cnpj ?? ""} não encontrada. Disponíveis: ` +
          empresas.map((e) => `${e.documento} (${e.razaoSocial})`).join(", "),
      );
    }

    const final = await requisicao<{ access_token: string }>(
      base,
      "/service-empresa/api/login/token",
      {
        method: "POST",
        headers: {
          APP_ID,
          PARAM_USER: "CodCliente",
          PARAM_LOGIN: alvo.clienteReferencia,
          CODIGO_USUARIO: inicial.codigo_usuario,
          PARAM_PRIV: `empresa=${alvo.idEmpresa}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: inicial.access_token,
        }).toString(),
      },
    );

    return new PortalClient(
      base,
      {
        token: final.access_token,
        codigoUsuario: inicial.codigo_usuario,
        idCliente: alvo.idCliente,
        idEmpresa: alvo.idEmpresa,
        tipoEmpresa: alvo.tipoEmpresa,
        razaoSocial: alvo.razaoSocial,
      },
      credenciais,
    );
  }

  /**
   * Resolve o nome do município a partir do código IBGE — o cadastro grava o
   * nome (`"VALINHOS"`), não o código. A listagem é por UF, que são os dois
   * primeiros dígitos do código do município.
   */
  async nomeDoMunicipio(codigoIbge: string | number): Promise<string> {
    const codigo = Number(codigoIbge);
    const uf = String(codigo).slice(0, 2);
    const resposta = await this.chamar<
      RespostaApi<Array<{ idMunicipioIbge: number; municipio: string }>>
    >(`/service-objetos-compartilhados/api/municipio-ibge/listar/${uf}`);

    const municipio = resposta.conteudo.find((m) => m.idMunicipioIbge === codigo);
    if (!municipio) {
      throw new Error(`Município ${codigoIbge} não encontrado na UF ${uf}`);
    }
    return municipio.municipio;
  }

  /** Lista os clientes (tipo 1) ou fornecedores (tipo 2) cadastrados. */
  async listar(tipo: TipoParticipante = 1): Promise<ParticipantePortal[]> {
    const { idCliente, idEmpresa } = this.sessao;
    const resposta = await this.chamar<RespostaApi<ParticipantePortal[]>>(
      `/service-empresa/api/cliente-fornecedor/cliente/${idCliente}/empresa/${idEmpresa}/tipo/${tipo}`,
    );
    return resposta.conteudo;
  }

  /** Busca um participante pelo id interno, com endereço. */
  async consultar(id: number): Promise<ParticipantePortal> {
    const resposta = await this.chamar<RespostaApi<ParticipantePortal>>(
      `/service-empresa/api/cliente-fornecedor/${this.sessao.idCliente}/${id}`,
    );
    return resposta.conteudo;
  }

  /** Procura por CPF/CNPJ entre os já cadastrados. */
  async buscarPorDocumento(
    documento: string,
    tipo: TipoParticipante = 1,
  ): Promise<ParticipantePortal | undefined> {
    const digitos = somenteDigitos(documento);
    const lista = await this.listar(tipo);
    return lista.find((p) => p.documento === digitos);
  }

  /** Cadastra um cliente ou fornecedor. */
  async criar(participante: ParticipantePortal): Promise<ParticipantePortal> {
    const resposta = await this.chamar<RespostaApi<ParticipantePortal>>(
      "/service-empresa/api/cliente-fornecedor/",
      { method: "POST", body: JSON.stringify(participante) },
    );
    return resposta.conteudo;
  }

  /** Atualiza um cadastro existente (exige o `id`). */
  async atualizar(participante: ParticipantePortal): Promise<ParticipantePortal> {
    if (!participante.id) throw new Error("Informe o id do cadastro a atualizar");
    const resposta = await this.chamar<RespostaApi<ParticipantePortal>>(
      "/service-empresa/api/cliente-fornecedor/",
      { method: "PUT", body: JSON.stringify(participante) },
    );
    return resposta.conteudo;
  }

  /** Remove um cadastro (o portal chama de "anular"). */
  async remover(participante: ParticipantePortal): Promise<void> {
    await this.chamar("/service-empresa/api/cliente-fornecedor/anula", {
      method: "PUT",
      body: JSON.stringify({ ...participante, ativo: false }),
    });
  }

  /**
   * O token dura cerca de 8 horas. Se expirar no meio de um processo longo, a
   * API responde 401/403 — aqui refazemos o login uma vez e repetimos a
   * chamada, para que quem usa a classe não precise tratar sessão.
   */
  private async chamar<T>(rota: string, init: RequestInit = {}): Promise<T> {
    const enviar = () =>
      requisicao<T>(this.base, rota, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.#sessao.token}`,
          ...init.headers,
        },
      });

    try {
      return await enviar();
    } catch (erro) {
      if (
        !(erro instanceof PortalError) ||
        (erro.status !== 401 && erro.status !== 403)
      ) {
        throw erro;
      }
      await this.renovar();
      return enviar();
    }
  }
}

async function requisicao<T>(
  base: string,
  rota: string,
  init: RequestInit,
): Promise<T> {
  const resposta = await fetch(new URL(rota, base), {
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });

  const texto = await resposta.text();
  let corpo: unknown;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }

  if (!resposta.ok) throw new PortalError(rota, resposta.status, corpo);
  return corpo as T;
}

/** Monta o corpo de um participante a partir de dados soltos. */
export function montarParticipante(
  sessao: Sessao,
  dados: {
    documento: string;
    razaoSocial: string;
    nomeFantasia?: string;
    inscricaoMunicipal?: string;
    tipo?: TipoParticipante;
    mei?: boolean;
    simplesNacional?: boolean;
    endereco?: Endereco & { tipoLogradouro?: string; cidade?: string };
  },
): ParticipantePortal {
  const documento = somenteDigitos(dados.documento);
  const endereco = dados.endereco;

  return {
    idCliente: sessao.idCliente,
    idEmpresa: sessao.idEmpresa,
    tipo: dados.tipo ?? 1,
    razaoSocial: dados.razaoSocial,
    nomeFantasia: dados.nomeFantasia,
    documento,
    tipoDocumento: documento.length > 11 ? 1 : 2,
    exterior: false,
    mei: dados.mei ?? false,
    simplesNacional: dados.simplesNacional ?? false,
    tipoEmpresa: sessao.tipoEmpresa,
    ativo: true,
    inscricaoMunicipal: dados.inscricaoMunicipal,
    endereco: endereco
      ? {
          idCliente: sessao.idCliente,
          tipo: 2,
          idIbge: Number(endereco.codigoMunicipio),
          // A UF é o prefixo de dois dígitos do código do município.
          idUfIbge: Number(String(endereco.codigoMunicipio).slice(0, 2)),
          tipoLogradouro: endereco.tipoLogradouro ?? "Rua",
          logradouro: endereco.logradouro,
          numero: endereco.numero,
          complemento: endereco.complemento,
          bairro: endereco.bairro,
          cep: somenteDigitos(endereco.cep),
          cidade: endereco.cidade ?? "",
          estado: endereco.uf,
          pais: 76,
          ativo: true,
        }
      : undefined,
  };
}
