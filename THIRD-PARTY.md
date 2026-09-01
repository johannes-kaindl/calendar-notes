# Third-Party Notices

This file lists code bundled into `main.js` that is not written for this repository, and the
licenses that apply to it.

## Runtime dependencies (bundled)

### ical.js — MPL-2.0

- Package: [`ical.js`](https://www.npmjs.com/package/ical.js), currently `^2.2` (installed:
  2.2.1).
- Upstream: <https://github.com/kewisch/ical.js>
- License: [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/).
- **Unmodified.** This project uses the published npm package as-is, with no local patches.
  Under MPL-2.0 §3.1, distributing unmodified Covered Software imposes no source-disclosure
  obligation beyond what upstream already provides — its source is public at the repository
  above. If this ever changes (a vendored fork with local edits), that fork's source must be
  published alongside the modification.

### fast-xml-parser — MIT

- Package: [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser), currently
  `^5.11.0` (installed: 5.11.0; raised from 4.5.7 on 2026-08-23 because the Store gate scan flags any version <5.7.0, GHSA-gh4j-gqv2-49f6).
- Upstream: <https://github.com/NaturalIntelligence/fast-xml-parser>
- License: MIT.
- Only `XMLParser` is used (`src/core/dav/xml.ts`) to parse CalDAV/CardDAV multistatus
  responses; `XMLBuilder` is not imported anywhere in this codebase — see
  [`docs/AUDIT.md`](docs/AUDIT.md) for why that matters for the known advisory against this
  dependency.

## Vendored source (copied into the tree, not an npm dependency)

`src/vendor/kit/` and `src/vendor/kit-obsidian/` contain modules copied from
[`obsidian-kit`](https://github.com/johannes-kaindl) — the maintainer's own shared library for
Obsidian plugins in this workspace (`obsidian-kit@0.28.0`, see `VENDOR.json` next to each
file for the exact commit and vendoring date; `tools/sync-kit.sh` re-vendors them). Both the
source library and this plugin are authored by Johannes Kaindl and licensed
AGPL-3.0-or-later, so no separate license section applies — see [`LICENSE`](LICENSE).

Files: `src/vendor/kit/vault-path.ts`, `src/vendor/kit/frontmatter.ts`,
`src/vendor/kit-obsidian/confirm.ts`, `src/vendor/kit-obsidian/settings_walker.ts`,
`src/vendor/kit-obsidian/folder-suggest.ts`.

`src/vendor/code-kit/` contains modules copied from `code-kit` (`code-kit@0.1.0`, see
`src/vendor/code-kit/VENDOR.json` for the exact commit and vendoring date) — the maintainer's
shared, platform-neutral module library for the whole `code/` workspace (kept locally,
not published to a public remote at time of writing). Like
`obsidian-kit`, it is authored by Johannes Kaindl and licensed AGPL-3.0-or-later (see its
`package.json`/`LICENSE`), so no separate license section applies here either — see
[`LICENSE`](LICENSE).

Files: `src/vendor/code-kit/filename-template.ts`, `src/vendor/code-kit/i18n.ts`,
`src/vendor/code-kit/settings.ts`, `src/vendor/code-kit/sha256.ts`,
`src/vendor/code-kit/timeout.ts`.

## Build/test tooling (not bundled)

Development dependencies (esbuild, TypeScript, ESLint, Vitest, and their transitive
dependencies) are not part of the distributed `main.js`/`manifest.json`/`styles.css` and are
not listed here individually; see `package.json` and `package-lock.json` for the full tree.
