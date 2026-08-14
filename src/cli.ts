import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Catalogo, documentoDe, type Papel } from "./catalogo.ts";
import { exportarPem } from "./cert.ts";
import {
  GissClient,
  GissError,
  type Nfse,
  type ResultadoConsulta,
} from "./client.ts";
import {
  carregarCredenciaisPortal,
  type Ambiente,
  type GissConfig,
} from "./config.ts";
import {
  montarParticipante,
  PortalClient,
  PortalError,
  type TipoParticipante,
} from "./portal.ts";
import { carregarPerfil, montarRps, salvarPerfil } from "./perfil.ts";
import { sincronizar } from "./sync.ts";
import { validarContraXsd } from "./validar.ts";
import type { CodigoCancelamento, Endereco, Rps } from "./types.ts";
import { data } from "./xml.ts";

const AJUDA = `
giss — cliente dos Web Services GissOnline (NFS-e ABRASF 2.04 + LC 214/2025)

Uso: npm run giss -- <comando> [opções]

CERTIFICADO
  cert [--exportar [--out DIR]]        Dados do certificado A1; --exportar grava os PEM

CONSULTAS (serviços prestados)
  prestado --inicio D --fim D          NFS-e emitidas por período de emissão
           [--competencia]               usa período de competência
           [--numero N] [--pagina N] [--todas]
  faixa --de N --ate N [--pagina N]    NFS-e por faixa de numeração
  rps --numero N --serie S [--tipo 1]  NFS-e gerada a partir de um RPS
  lote --protocolo P                   Situação de um lote de RPS

CONSULTAS (serviços tomados)
  tomado --inicio D --fim D            NFS-e em que você é o tomador
         [--competencia] [--numero N] [--pagina N] [--todas]
  comprado-lote --protocolo P          Notas declaradas em um lote (nfsc)
  comprado-protocolo --protocolo P     Situação de um protocolo (nfsc)
  comprado-numero --inicio D --fim D --numero N --serie S

EMISSÃO
  emitir --tomador X --valor V [--descricao T]      Emite NFS-e (GerarNfse)
         [--rps N] [--serie S]                        via RPS quando --rps é informado
         [--competencia D] [--csll V] [--inss V] [--ir V]
         [--info T] [--confirmar]
  cancelar --numero N --motivo 1..5 [--confirmar]   Cancela uma NFS-e
  substituir --numero N --motivo 1..5 --tomador X --valor V
             [--descricao T] [--confirmar]          Cancela e reemite

CADASTROS (catálogo local — o WS não expõe cadastro)
  clientes [--sincronizar --inicio D --fim D]       Lista/atualiza tomadores
  fornecedores [--sincronizar --inicio D --fim D]   Lista/atualiza prestadores
  cliente-add --documento D --nome N [--apelido A] [--im N] [--email E] [--telefone T]
              [--logradouro L --numero N --bairro B --cidade IBGE --uf UF --cep C]
              [--complemento C] [--fantasia F] [--simples 1|2]
  fornecedor-add  (mesmas opções de cliente-add)
  cliente-rm --documento D
  fornecedor-rm --documento D

PORTAL (API REST — cadastro de verdade no GissOnline, via login CPF/senha)
  portal-clientes [--tipo 1|2]                      Lista o cadastro do portal (1=cliente, 2=fornecedor)
  portal-add --documento D --nome N [--tipo 1|2]    Cadastra no portal
             [--fantasia F] [--im N] [--simples] [--mei]
             [--logradouro L --numero N --bairro B --cidade IBGE --uf UF --cep C]
             [--complemento C] [--tipo-logradouro Rua] [--confirmar]
  portal-rm --documento D [--tipo 1|2] [--confirmar] Remove do portal
  portal-importar [--tipo 1|2]                      Traz o cadastro do portal para o catálogo local

PERFIL FISCAL
  perfil [--salvar]                    Mostra (ou grava em dados/perfil.json) os padrões de emissão

Opções globais:
  --env producao|homologacao   Ambiente (padrão: GISS_ENV do .env)
  --json | --xml | --debug     Formato de saída / diagnóstico
`;

const opcoes = {
  env: { type: "string" },
  inicio: { type: "string" },
  fim: { type: "string" },
  competencia: { type: "string" },
  numero: { type: "string" },
  serie: { type: "string" },
  tipo: { type: "string" },
  pagina: { type: "string" },
  todas: { type: "boolean", default: false },
  de: { type: "string" },
  ate: { type: "string" },
  protocolo: { type: "string" },
  exportar: { type: "boolean", default: false },
  out: { type: "string" },
  tomador: { type: "string" },
  valor: { type: "string" },
  descricao: { type: "string" },
  info: { type: "string" },
  rps: { type: "string" },
  csll: { type: "string" },
  inss: { type: "string" },
  ir: { type: "string" },
  motivo: { type: "string" },
  confirmar: { type: "boolean", default: false },
  sincronizar: { type: "boolean", default: false },
  documento: { type: "string" },
  nome: { type: "string" },
  fantasia: { type: "string" },
  im: { type: "string" },
  email: { type: "string" },
  telefone: { type: "string" },
  apelido: { type: "string" },
  logradouro: { type: "string" },
  bairro: { type: "string" },
  complemento: { type: "string" },
  cidade: { type: "string" },
  uf: { type: "string" },
  cep: { type: "string" },
  simples: { type: "string" },
  salvar: { type: "boolean", default: false },
  "tipo-logradouro": { type: "string" },
  mei: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  xml: { type: "boolean", default: false },
  debug: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} as const;

type Valores = ReturnType<typeof parseArgs<{ options: typeof opcoes; allowPositionals: true }>>["values"];

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: opcoes,
    allowPositionals: true,
  });

  const comando = positionals[0];
  if (!comando || values.help) {
    console.log(AJUDA);
    return;
  }

  // Comandos de catálogo e perfil não tocam a rede nem o certificado.
  if (await comandoLocal(comando, values)) return;

  const cliente = new GissClient({
    ambiente: values.env as Ambiente | undefined,
    debug: values.debug,
  });
  const inteiro = (v: string | undefined) => (v === undefined ? undefined : Number(v));

  switch (comando) {
    case "cert": {
      const { titular, validoDe, validoAte } = cliente.certificado;
      console.log(`Titular:    ${titular}`);
      console.log(`Válido de:  ${validoDe.toISOString().slice(0, 10)}`);
      console.log(`Válido até: ${validoAte.toISOString().slice(0, 10)}`);
      console.log(`Ambiente:   ${cliente.config.ambiente}`);
      console.log(`Host:       ${cliente.config.host}`);
      console.log(
        `Prestador:  CNPJ ${cliente.config.cnpj} / IM ${cliente.config.inscricaoMunicipal}`,
      );

      if (values.exportar) {
        const destino = values.out ?? dirname(cliente.config.certPath);
        const arquivos = exportarPem(cliente.certificado, destino);
        console.log("\nPEM exportado:");
        console.log(`  certificado: ${arquivos.certificado}`);
        console.log(`  chave:       ${arquivos.chave}`);
        if (arquivos.cadeia) console.log(`  cadeia:      ${arquivos.cadeia}`);
        console.log(`  bundle:      ${arquivos.bundle}`);
        console.log("\nA chave está sem senha — não versione esses arquivos.");
      }
      return;
    }

    case "prestado":
    case "tomado": {
      const tomado = comando === "tomado";
      const filtro = values.numero
        ? { numeroNfse: values.numero }
        : montarPeriodo(values.inicio, values.fim, Boolean(values.competencia));
      const consulta = (pagina: number) =>
        tomado
          ? cliente.consultarNfseServicoTomado({ ...filtro, pagina })
          : cliente.consultarNfseServicoPrestado({ ...filtro, pagina });

      if (values.todas && !values.numero) {
        let total = 0;
        for await (const pagina of cliente.paginar(consulta)) {
          total += pagina.notas.length;
          imprimir(pagina, values, tomado);
        }
        if (!values.json && !values.xml) console.log(`\nTotal: ${total} nota(s)`);
        return;
      }

      imprimir(await consulta(inteiro(values.pagina) ?? 1), values, tomado);
      return;
    }

    case "faixa": {
      if (!values.de || !values.ate) {
        throw new Error("Informe --de e --ate com os números inicial e final");
      }
      imprimir(
        await cliente.consultarNfsePorFaixa({
          numeroInicial: values.de,
          numeroFinal: values.ate,
          pagina: inteiro(values.pagina),
        }),
        values,
      );
      return;
    }

    case "rps": {
      if (!values.numero || !values.serie) {
        throw new Error("Informe --numero e --serie do RPS");
      }
      imprimir(
        await cliente.consultarNfsePorRps({
          numero: values.numero,
          serie: values.serie,
          tipo: values.tipo ? (Number(values.tipo) as 1 | 2 | 3) : undefined,
        }),
        values,
      );
      return;
    }

    case "lote": {
      if (!values.protocolo) throw new Error("Informe --protocolo do lote");
      const resultado = await cliente.consultarLoteRps(values.protocolo);
      if (values.xml) return void console.log(resultado.xml);
      if (values.json) return void console.log(JSON.stringify(resultado, null, 2));
      console.log(`Situação: ${resultado.situacao} — ${resultado.situacaoDescricao}`);
      if (resultado.numeroLote) console.log(`Lote:     ${resultado.numeroLote}`);
      if (resultado.dataRecebimento) {
        console.log(`Recebido: ${resultado.dataRecebimento}`);
      }
      imprimir(resultado, values);
      return;
    }

    case "comprado-lote": {
      if (!values.protocolo) throw new Error("Informe --protocolo");
      imprimir(await cliente.consultarServicoCompradoPorLote(values.protocolo), values);
      return;
    }

    case "comprado-protocolo": {
      if (!values.protocolo) throw new Error("Informe --protocolo");
      const resultado = await cliente.consultarServicoCompradoPorProtocolo(
        values.protocolo,
      );
      if (values.xml) return void console.log(resultado.xml);
      console.log(`Situação: ${resultado.situacao} — ${resultado.situacaoDescricao}`);
      imprimir(resultado, values);
      return;
    }

    case "comprado-numero": {
      if (!values.inicio || !values.fim || !values.numero || !values.serie) {
        throw new Error("Informe --inicio, --fim, --numero e --serie");
      }
      const intervalo = { inicial: values.inicio, final: values.fim };
      imprimir(
        await cliente.consultarServicoCompradoPorNumero({
          periodoEmissao: intervalo,
          periodoCompetencia: intervalo,
          numeroDeclarado: values.numero,
          serieDeclarada: values.serie,
        }),
        values,
        true,
      );
      return;
    }

    case "emitir": {
      const rps = montarRpsDoCli(values);
      if (!values.confirmar) {
        const previa = cliente.previewGerarNfse(rps);
        if (values.xml) return void console.log(previa);
        console.log(resumoEmissao(values, rps));

        const validacao = validarContraXsd(previa, "gerar-nfse-envio-v2_04.xsd");
        if (validacao === null) {
          console.log("\nSchema: não verificado (xmllint não instalado).");
        } else if (validacao.valido) {
          console.log("\nSchema: XML válido contra gerar-nfse-envio-v2_04.xsd.");
        } else {
          console.log("\nSchema: XML INVÁLIDO —");
          for (const erro of validacao.erros) console.log(`  ${erro}`);
        }

        console.log("\nNada foi enviado. Repita com --confirmar para emitir de verdade.");
        return;
      }
      const resultado = rps.identificacao
        ? await cliente.enviarLoteRpsSincrono({
            numeroLote: Number(values.rps),
            rps: [rps],
          })
        : await cliente.gerarNfse(rps);
      console.log("NFS-e emitida:");
      imprimir(resultado, values);
      return;
    }

    case "cancelar": {
      if (!values.numero || !values.motivo) {
        throw new Error("Informe --numero da NFS-e e --motivo (1 a 5)");
      }
      if (!values.confirmar) {
        console.log(
          `Cancelaria a NFS-e ${values.numero} com o motivo ${values.motivo} (${MOTIVOS[values.motivo] ?? "?"}).`,
        );
        console.log("Nada foi enviado. Repita com --confirmar.");
        return;
      }
      const resultado = await cliente.cancelarNfse({
        numeroNfse: values.numero,
        codigoCancelamento: Number(values.motivo) as CodigoCancelamento,
      });
      console.log(`NFS-e ${values.numero} cancelada.`);
      if (resultado.dataHoraCancelamento) {
        console.log(`Data/hora: ${resultado.dataHoraCancelamento}`);
      }
      return;
    }

    case "substituir": {
      if (!values.numero || !values.motivo) {
        throw new Error("Informe --numero da NFS-e substituída e --motivo (1 a 5)");
      }
      const rps = montarRpsDoCli(values);
      if (!values.confirmar) {
        console.log(
          `Substituiria a NFS-e ${values.numero} (motivo ${values.motivo}) por:\n`,
        );
        console.log(resumoEmissao(values, rps));
        console.log("\nNada foi enviado. Repita com --confirmar.");
        return;
      }
      const resultado = await cliente.substituirNfse(
        {
          numeroNfse: values.numero,
          codigoCancelamento: Number(values.motivo) as CodigoCancelamento,
        },
        rps,
      );
      console.log(`NFS-e ${values.numero} substituída por:`);
      imprimir(resultado, values);
      return;
    }

    case "portal-clientes":
    case "portal-add":
    case "portal-rm":
    case "portal-importar":
      await comandoPortal(comando, values, cliente.config);
      return;

    case "clientes":
    case "fornecedores": {
      const papel: Papel = comando === "clientes" ? "cliente" : "fornecedor";
      const catalogo = new Catalogo();

      if (values.sincronizar) {
        const filtro = montarPeriodo(values.inicio, values.fim, Boolean(values.competencia));
        const notas: Nfse[] = [];
        const consulta = (pagina: number) =>
          papel === "cliente"
            ? cliente.consultarNfseServicoPrestado({ ...filtro, pagina })
            : cliente.consultarNfseServicoTomado({ ...filtro, pagina });
        for await (const pagina of cliente.paginar(consulta)) {
          notas.push(...pagina.notas);
        }
        const { registrados } = sincronizar(catalogo, papel, notas);
        console.log(
          `${registrados} ${papel}(s) sincronizado(s) a partir de ${notas.length} nota(s).\n`,
        );
      }

      imprimirCatalogo(catalogo, papel, values);
      return;
    }

    default:
      throw new Error(`Comando desconhecido: ${comando}`);
  }
}

const MOTIVOS: Record<string, string> = {
  "1": "erro na emissão",
  "2": "serviço não prestado",
  "3": "erro de assinatura",
  "4": "duplicidade da nota",
  "5": "erro de processamento",
};

/** Comandos que não precisam de rede nem de certificado. */
async function comandoLocal(comando: string, values: Valores): Promise<boolean> {
  switch (comando) {
    case "cliente-add":
    case "fornecedor-add": {
      const papel: Papel = comando === "cliente-add" ? "cliente" : "fornecedor";
      if (!values.documento || !values.nome) {
        throw new Error("Informe --documento e --nome");
      }
      const registro = new Catalogo().registrar(papel, {
        documento: values.documento,
        razaoSocial: values.nome,
        nomeFantasia: values.fantasia,
        inscricaoMunicipal: values.im,
        email: values.email,
        telefone: values.telefone,
        apelido: values.apelido,
        endereco: montarEndereco(values),
        optanteSimplesNacional: values.simples
          ? (Number(values.simples) as 1 | 2)
          : undefined,
      });
      console.log(`${papel} salvo: ${registro.razaoSocial} (${registro.documento})`);
      if (!registro.endereco) {
        console.log(
          "Atenção: sem endereço. A emissão de NFS-e exige endereço do tomador.",
        );
      }
      return true;
    }

    case "cliente-rm":
    case "fornecedor-rm": {
      const papel: Papel = comando === "cliente-rm" ? "cliente" : "fornecedor";
      if (!values.documento) throw new Error("Informe --documento");
      const removido = new Catalogo().remover(papel, values.documento);
      console.log(removido ? `${papel} removido.` : `${papel} não encontrado.`);
      return true;
    }

    case "perfil": {
      const perfil = carregarPerfil();
      if (values.salvar) {
        console.log(`Perfil gravado em ${salvarPerfil(perfil)}`);
      }
      console.log(JSON.stringify(perfil, null, 2));
      return true;
    }

    default:
      return false;
  }
}

/** Comandos que falam com a API REST do portal, não com o Web Service. */
async function comandoPortal(
  comando: string,
  values: Valores,
  config: GissConfig,
): Promise<void> {
  const tipo = (values.tipo ? Number(values.tipo) : 1) as TipoParticipante;
  const rotulo = tipo === 1 ? "cliente" : "fornecedor";
  const portal = await PortalClient.autenticar(carregarCredenciaisPortal(config));

  if (comando === "portal-clientes") {
    const lista = await portal.listar(tipo);
    if (values.json) return void console.log(JSON.stringify(lista, null, 2));
    for (const p of lista) {
      console.log(
        [p.documento.padEnd(14), p.razaoSocial, p.nomeFantasia ?? ""]
          .filter(Boolean)
          .join("  |  "),
      );
    }
    console.log(`\n${lista.length} ${rotulo}(s) — ${portal.sessao.razaoSocial}`);
    return;
  }

  if (comando === "portal-importar") {
    const catalogo = new Catalogo();
    const lista = await portal.listar(tipo);
    for (const p of lista) {
      const completo = p.endereco ? p : await portal.consultar(p.id!);
      catalogo.registrar(tipo === 1 ? "cliente" : "fornecedor", {
        documento: completo.documento,
        razaoSocial: completo.razaoSocial,
        nomeFantasia: completo.nomeFantasia,
        inscricaoMunicipal: completo.inscricaoMunicipal,
        endereco: completo.endereco
          ? {
              logradouro:
                `${completo.endereco.tipoLogradouro} ${completo.endereco.logradouro}`.trim(),
              numero: completo.endereco.numero,
              complemento: completo.endereco.complemento,
              bairro: completo.endereco.bairro,
              codigoMunicipio: String(completo.endereco.idIbge),
              uf: completo.endereco.estado,
              cep: completo.endereco.cep,
            }
          : undefined,
        origem: "portal",
      });
    }
    console.log(`${lista.length} ${rotulo}(s) importado(s) do portal.`);
    return;
  }

  if (comando === "portal-rm") {
    if (!values.documento) throw new Error("Informe --documento");
    const existente = await portal.buscarPorDocumento(values.documento, tipo);
    if (!existente) {
      console.log(`${rotulo} ${values.documento} não está cadastrado no portal.`);
      return;
    }
    if (!values.confirmar) {
      console.log(`Removeria: ${existente.razaoSocial} (${existente.documento})`);
      console.log("Nada foi enviado. Repita com --confirmar.");
      return;
    }
    await portal.remover(await portal.consultar(existente.id!));
    console.log(`${rotulo} removido do portal: ${existente.razaoSocial}`);
    return;
  }

  // portal-add
  if (!values.documento || !values.nome) {
    throw new Error("Informe --documento e --nome");
  }

  const existente = await portal.buscarPorDocumento(values.documento, tipo);
  if (existente) {
    console.log(
      `Já cadastrado no portal: ${existente.razaoSocial} (${existente.documento}).`,
    );
    return;
  }

  const endereco = montarEndereco(values);
  const nomeMunicipio = endereco
    ? await portal.nomeDoMunicipio(endereco.codigoMunicipio)
    : undefined;
  const participante = montarParticipante(portal.sessao, {
    documento: values.documento,
    razaoSocial: values.nome,
    nomeFantasia: values.fantasia,
    inscricaoMunicipal: values.im,
    tipo,
    mei: values.mei,
    simplesNacional: values.simples === "1",
    endereco: endereco
      ? {
          ...endereco,
          tipoLogradouro: values["tipo-logradouro"],
          cidade: nomeMunicipio,
        }
      : undefined,
  });

  if (!values.confirmar) {
    console.log(`Cadastraria no portal (${portal.sessao.razaoSocial}):\n`);
    console.log(JSON.stringify(participante, null, 2));
    console.log("\nNada foi enviado. Repita com --confirmar.");
    return;
  }

  const criado = await portal.criar(participante);
  console.log(
    `${rotulo} cadastrado no portal: ${criado.razaoSocial} (id ${criado.id})`,
  );
}

/** Monta o endereço do participante; o XSD exige o grupo completo ou nenhum. */
function montarEndereco(values: Valores): Endereco | undefined {
  if (!values.logradouro) return undefined;
  const faltando = (["bairro", "cidade", "uf", "cep"] as const).filter(
    (campo) => !values[campo],
  );
  if (faltando.length > 0) {
    throw new Error(
      `Endereço incompleto — faltam: ${faltando.map((c) => `--${c}`).join(", ")}. ` +
        "--cidade recebe o código IBGE de 7 dígitos.",
    );
  }
  return {
    logradouro: values.logradouro,
    numero: values.numero ?? "S/N",
    complemento: values.complemento,
    bairro: values.bairro!,
    codigoMunicipio: values.cidade!,
    uf: values.uf!.toUpperCase(),
    cep: values.cep!.replace(/\D/g, ""),
  };
}

function montarRpsDoCli(values: Valores): Rps {
  if (!values.tomador || !values.valor) {
    throw new Error("Informe --tomador (documento ou apelido) e --valor");
  }

  const catalogo = new Catalogo();
  const registro = catalogo.buscar("cliente", values.tomador);
  if (!registro) {
    throw new Error(
      `Tomador "${values.tomador}" não está no catálogo. Cadastre com cliente-add ou rode clientes --sincronizar.`,
    );
  }

  return montarRps(carregarPerfil(), {
    tomador: catalogo.comoTomador(registro),
    valorServicos: Number(values.valor),
    discriminacao: values.descricao,
    competencia: values.competencia,
    numeroRps: values.rps,
    serie: values.serie,
    csll: values.csll ? Number(values.csll) : undefined,
    inss: values.inss ? Number(values.inss) : undefined,
    ir: values.ir ? Number(values.ir) : undefined,
    informacoesComplementares: values.info,
  });
}

function resumoEmissao(values: Valores, rps: Rps): string {
  const linhas = [
    `Tomador:      ${rps.tomador?.razaoSocial} (${rps.tomador?.cnpj ?? rps.tomador?.cpf})`,
    `Valor:        R$ ${Number(values.valor).toFixed(2)}`,
    `Competência:  ${data(rps.competencia)}`,
    `Discriminação: ${rps.servico.discriminacao}`,
    `Item LC 116:  ${rps.servico.itemListaServico}`,
    `ISS retido:   ${rps.servico.issRetido === 1 ? "sim" : "não"}`,
  ];
  if (rps.identificacao) {
    linhas.push(
      `RPS:          ${rps.identificacao.numero} série ${rps.identificacao.serie}`,
    );
  }
  return linhas.join("\n");
}

function montarPeriodo(
  inicio: string | undefined,
  fim: string | undefined,
  competencia: boolean,
) {
  if (!inicio || !fim) {
    throw new Error("Informe --inicio e --fim no formato AAAA-MM-DD (ou use --numero)");
  }
  const intervalo = { inicial: inicio, final: fim };
  return competencia
    ? { periodoCompetencia: intervalo }
    : { periodoEmissao: intervalo };
}

function imprimir(
  resultado: ResultadoConsulta,
  values: Valores,
  mostrarPrestador = false,
) {
  if (values.xml) return void console.log(resultado.xml);
  if (values.json) return void console.log(JSON.stringify(resultado.notas, null, 2));

  for (const alerta of resultado.alertas) {
    console.log(`⚠ [${alerta.codigo}] ${alerta.mensagem}`);
  }

  if (resultado.notas.length === 0) {
    console.log("Nenhuma NFS-e encontrada.");
    return;
  }

  for (const nota of resultado.notas) {
    const parte = mostrarPrestador ? nota.prestador : nota.tomador;
    console.log(
      [
        `NFS-e ${nota.numero}`,
        nota.dataEmissao?.slice(0, 10),
        parte?.razaoSocial ?? parte?.documento ?? "",
        nota.valorServicos ? `R$ ${nota.valorServicos}` : "",
        nota.codigoVerificacao,
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }
}

function imprimirCatalogo(catalogo: Catalogo, papel: Papel, values: Valores) {
  const registros = catalogo.listar(papel);
  if (values.json) return void console.log(JSON.stringify(registros, null, 2));

  if (registros.length === 0) {
    console.log(`Nenhum ${papel} no catálogo (${catalogo.caminho}).`);
    return;
  }

  for (const registro of registros) {
    const doc = documentoDe(registro.documento);
    console.log(
      [
        (doc.cnpj ?? doc.cpf ?? "").padEnd(14),
        registro.razaoSocial,
        registro.apelido ? `(${registro.apelido})` : "",
        registro.email ?? "",
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }
  console.log(`\n${registros.length} ${papel}(s) — ${catalogo.caminho}`);
}

main().catch((erro: unknown) => {
  if (erro instanceof GissError) {
    console.error(`\n${erro.operacao} retornou erro:`);
    for (const m of erro.mensagens) {
      console.error(`  [${m.codigo}] ${m.mensagem}${m.correcao ? ` — ${m.correcao}` : ""}`);
    }
  } else if (erro instanceof PortalError) {
    console.error(`\nAPI do portal: ${erro.message}`);
  } else {
    console.error(erro instanceof Error ? erro.message : erro);
  }
  process.exitCode = 1;
});
