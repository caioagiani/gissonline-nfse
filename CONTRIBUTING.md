# Contributing

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org).
The rule is enforced twice: a local `commit-msg` hook (installed by `npm install`)
and a CI check on every pull request.

```
<type>(<scope>)<!>: <subject>

<body>

<footer>
```

### Types

| Type | Use for | Release |
| --- | --- | --- |
| `feat` | a new capability | **minor** |
| `fix` | a bug fix | **patch** |
| `docs` | documentation only | — |
| `refactor` | code change that neither fixes a bug nor adds a feature | — |
| `perf` | performance improvement | patch |
| `test` | adding or fixing tests | — |
| `build` | build system or dependencies | — |
| `ci` | CI configuration | — |
| `chore` | anything else that does not touch `src/` | — |
| `revert` | reverts a previous commit | — |

Add `!` after the scope — or a `BREAKING CHANGE:` footer — for anything that
breaks existing usage. That is a **major** release.

### Scopes

Optional, but when present must be one of: `nfse`, `nfsc`, `portal`, `cli`,
`domain`, `infra`, `messages`, `storage`, `validation`, `config`, `docs`, `ci`,
`deps`.

### Subject

- imperative mood, lowercase, no trailing period
- 72 characters max for the whole header
- describe the change, not the file touched

### Body

Explain **why**, not what — the diff already says what. Wrap at 80 columns.
This matters more than usual here: much of this codebase encodes behaviour of a
service whose documentation is wrong in places, and the reason a line exists is
often impossible to recover from the code alone.

```
fix(nfse): send the ISS rate as a fraction

The service expects 0.0307 for 3.07%, but queries return the percentage —
copying the value from a response into a request yields E165. The conversion
now happens in the builder, so the API keeps taking percentages.
```

### Examples

```
feat(cli): add the latest command
fix(portal): party role does not belong in the listing route
docs: document the async batch as the only issuing path
refactor(storage): move the directory behind a repository
feat(cli)!: english commands and flags
chore(deps): bump xml-crypto to 6.1.2
```

## Before opening a pull request

```bash
npm run typecheck
npm run build
npm run commitlint     # checks your commits against origin/main
```

## Releasing

Nothing to run by hand. [release-please](https://github.com/googleapis/release-please)
watches `main` and keeps a release pull request open, holding the next version and
the changelog derived from the commit types:

```
chore(main): release 1.2.0

### Features
* add the latest command

### Bug Fixes
* send the ISS rate as a fraction
```

Merging that pull request creates the tag and the GitHub release, and publishes
to npm through trusted publishing.

This is why the commit type matters: it is the only input to the version. A
`fix` labelled as `chore` never ships.
