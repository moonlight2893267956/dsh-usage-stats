# Archived material

This directory keeps the files that described the plugin's previous life as a
source-of-record archive for two in-tree harness packages. Nothing here is part
of the published artifact; the installable plugin lives in `packages/usage-stats`.

- `legacy-repo-README.md` — the repository README from before the plugin became
  installable: it documented copying both packages into a harness checkout.
- `legacy-wiring.patch` — the harness-side wiring that copy-in workflow applied
  (profile rows, the api-remotes seat, generated docs). The plugin's own
  `cordis.patch.yml` replaces every hunk of it.
- `client-ui-usage.README.*` — the separate browser-package README. Its content
  is folded into `packages/usage-stats/README.md`, which now documents both
  halves.
