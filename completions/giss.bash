# Bash completion for the giss CLI. For zsh use `_giss` in this same folder.
#   source completions/giss.bash
# or copy it to /usr/local/etc/bash_completion.d/ (or /etc/bash_completion.d/).
_giss_completions() {
  local cur prev commands global_opts opts
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  commands="cert latest issued range rps batch received purchased-batch \
purchased-protocol purchased-number issue cancel replace customers \
suppliers customer-add supplier-add customer-rm supplier-rm \
portal-list portal-add portal-rm portal-import pdf xml zip cnpj profile"

  global_opts="--env --json --xml --debug --help"

  # known values for some flags
  case "$prev" in
    --env)     COMPREPLY=($(compgen -W "producao homologacao" -- "$cur")); return ;;
    --reason)  COMPREPLY=($(compgen -W "1 2 3 4 5" -- "$cur")); return ;;
    --type)    COMPREPLY=($(compgen -W "1 2" -- "$cur")); return ;;
    --simples) COMPREPLY=($(compgen -W "1 2" -- "$cur")); return ;;
    --out)     COMPREPLY=($(compgen -d -- "$cur")); return ;;
  esac

  # first argument: the command
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "${COMP_WORDS[1]}" in
    cert)            opts="--export --out" ;;
    latest)          opts="--limit --months" ;;
    issued|received) opts="--from --to --competence --number --page --all" ;;
    range)           opts="--first --last --page" ;;
    rps)             opts="--number --series --type" ;;
    batch|purchased-batch|purchased-protocol) opts="--protocol" ;;
    purchased-number) opts="--from --to --number --series" ;;
    issue)           opts="--customer --amount --description --competence --rps --series \
--item --cnae --nbs --rate --csll --inss --income-tax --notes --confirm" ;;
    cancel)          opts="--number --reason --confirm" ;;
    replace)         opts="--number --reason --customer --amount --description --confirm" ;;
    customers|suppliers) opts="--sync --from --to" ;;
    customer-add|supplier-add|portal-add)
      opts="--tax-id --name --alias --registration --email --phone --trade-name \
--street --number --district --city --state --zip --complement --street-type \
--simples --mei --type --confirm" ;;
    customer-rm|supplier-rm) opts="--tax-id" ;;
    portal-rm)       opts="--tax-id --type --confirm" ;;
    portal-list|portal-import) opts="--type" ;;
    pdf|xml)         opts="--number --out" ;;
    profile)         opts="--save" ;;
    *)               opts="" ;;
  esac

  COMPREPLY=($(compgen -W "$opts $global_opts" -- "$cur"))
}
complete -F _giss_completions giss
