# Completion bash para o CLI giss.
#   source completions/giss.bash
# ou copie para /usr/local/etc/bash_completion.d/ (ou /etc/bash_completion.d/).
_giss_completions() {
  local cur prev commands global_opts opts
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  commands="cert ultimas prestado faixa rps lote tomado comprado-lote \
comprado-protocolo comprado-numero emitir cancelar substituir clientes \
fornecedores cliente-add fornecedor-add cliente-rm fornecedor-rm \
portal-clientes portal-add portal-rm portal-importar perfil"

  global_opts="--env --json --xml --debug --help"

  # valores conhecidos de algumas flags
  case "$prev" in
    --env)     COMPREPLY=($(compgen -W "producao homologacao" -- "$cur")); return ;;
    --motivo)  COMPREPLY=($(compgen -W "1 2 3 4 5" -- "$cur")); return ;;
    --tipo)    COMPREPLY=($(compgen -W "1 2" -- "$cur")); return ;;
    --simples) COMPREPLY=($(compgen -W "1 2" -- "$cur")); return ;;
    --out)     COMPREPLY=($(compgen -d -- "$cur")); return ;;
  esac

  # primeiro argumento: comando
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "${COMP_WORDS[1]}" in
    cert)            opts="--exportar --out" ;;
    ultimas)         opts="--limite --meses" ;;
    prestado|tomado) opts="--inicio --fim --competencia --numero --pagina --todas" ;;
    faixa)           opts="--de --ate --pagina" ;;
    rps)             opts="--numero --serie --tipo" ;;
    lote|comprado-lote|comprado-protocolo) opts="--protocolo" ;;
    comprado-numero) opts="--inicio --fim --numero --serie" ;;
    emitir)          opts="--tomador --valor --descricao --competencia --rps --serie \
--item --cnae --nbs --aliquota --csll --inss --ir --info --confirmar" ;;
    cancelar)        opts="--numero --motivo --confirmar" ;;
    substituir)      opts="--numero --motivo --tomador --valor --descricao --confirmar" ;;
    clientes|fornecedores) opts="--sincronizar --inicio --fim" ;;
    cliente-add|fornecedor-add|portal-add)
      opts="--documento --nome --apelido --im --email --telefone --fantasia \
--logradouro --numero --bairro --cidade --uf --cep --complemento --tipo-logradouro \
--simples --mei --tipo --confirmar" ;;
    cliente-rm|fornecedor-rm) opts="--documento" ;;
    portal-rm)       opts="--documento --tipo --confirmar" ;;
    portal-clientes|portal-importar) opts="--tipo" ;;
    perfil)          opts="--salvar" ;;
    *)               opts="" ;;
  esac

  COMPREPLY=($(compgen -W "$opts $global_opts" -- "$cur"))
}
complete -F _giss_completions giss
