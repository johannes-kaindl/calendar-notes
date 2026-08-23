# Dependency Audit

`npm audit` output as of 2026-08-23, before this repo's first release. Not re-run
automatically — re-check before future releases if dependencies move.

## Summary

```
6 vulnerabilities (4 moderate, 1 high, 1 critical)
```

All six trace back to two roots: `esbuild` (dev-only bundler) and `fast-xml-parser` (runtime
dependency). No dependency was bumped as part of this task — see decisions below.

## Dev-dependency chain (5 of 6, not shipped)

```
esbuild <=0.24.2 (moderate, GHSA-67mh-4wv8-2f99)
  -> vite <=6.4.2 (moderate/high, several GHSA IDs, worst is GHSA-fx2h-pf6j-xcff, high)
     -> vite-node <=2.2.0-beta.2 (moderate)
     -> @vitest/mocker <=3.0.0-beta.4 (moderate)
        -> vitest <=3.2.5 (critical, GHSA-5xrq-8626-4rwp)
```

- `esbuild`'s own advisory: a dev server started with `esbuild --serve` accepts requests from
  any website and echoes the response (CWE-346). This plugin's `npm run dev`/`build` scripts
  never start esbuild in serve mode — only the bundling API is used
  (`esbuild.config.mjs`) — so the vulnerable code path is not exercised here even in
  development.
- The **critical** entry is `vitest`'s advisory (GHSA-5xrq-8626-4rwp, CVSS 9.8): when
  `vitest`'s UI server is listening, an attacker who can reach it can read and execute
  arbitrary files. `npm test`/`npm run gate` run Vitest in `run` mode (`vitest run …`), which
  never starts the UI server — that requires an explicit `vitest --ui` invocation this
  project's scripts never make. It is transitive, dev-only, and not part of what ships in
  `main.js`.

**Decision:** leave as-is for this release. None of these packages are bundled into
`main.js`/`manifest.json`/`styles.css` (the only files a plugin install actually runs), and
the exploitable surface (a locally-started dev/UI server) is not something this plugin's
scripts start. Revisit at the next dependency-maintenance pass — `npm audit fix --force`
would move to `esbuild@0.28.2`/newer `vitest`, both breaking-change bumps that deserve their
own gate run rather than riding along with a release task.

## Runtime dependency: fast-xml-parser (1 of 6, shipped)

```
fast-xml-parser <5.7.0 (moderate, GHSA-gh4j-gqv2-49f6)
"fast-xml-parser XMLBuilder: XML Comment and CDATA Injection via Unescaped Delimiters"
```

This is the one advisory in a dependency that ships inside `main.js`. It affects
`XMLBuilder` — building XML from untrusted input can smuggle content past comment/CDATA
delimiters that aren't escaped.

**Not exploitable here:** `grep -rn "XMLBuilder\|XMLParser" src/` shows this codebase only
imports and uses `XMLParser` (`src/core/dav/xml.ts`), to parse CalDAV/CardDAV multistatus
XML responses coming back from the configured server. `XMLBuilder` is never imported. The
plugin does not construct XML requests via this library at all (CalDAV/CardDAV request
bodies are built as plain template strings — see `src/core/dav/`).

**Decision:** no code change needed; the vulnerable code path is unreachable. Documented
here per PROF-OBS release-audit convention rather than silently ignored. Revisit if a future
change starts building XML via `fast-xml-parser` (`XMLBuilder`) instead of parsing it.

## What's out of scope for this task

No dependency versions were bumped as part of Task 3 (release infrastructure). Any
`npm audit fix` is a separate, deliberate maintenance step with its own gate run.
