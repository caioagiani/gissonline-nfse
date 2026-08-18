/**
 * Conventional Commits — https://www.conventionalcommits.org
 *
 * The commit type drives the release: `fix` becomes a patch, `feat` a minor,
 * and anything marked breaking a major. Keeping the history well typed is what
 * lets the version be derived instead of guessed.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Scopes are optional, but when present must be one of the project's areas.
    "scope-enum": [
      2,
      "always",
      [
        "nfse", // services provided
        "nfsc", // services received
        "portal", // portal REST API
        "cli",
        "domain",
        "infra",
        "messages",
        "storage",
        "validation",
        "config",
        "docs",
        "ci",
        "deps",
      ],
    ],
    // Long subjects get truncated in most git UIs.
    "header-max-length": [2, "always", 72],
    // The body explains why; wrap it so `git log` stays readable in a terminal.
    "body-max-line-length": [1, "always", 80],
  },
};
