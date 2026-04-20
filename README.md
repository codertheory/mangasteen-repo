# mangasteen-repo

A source extension repository for **[Mangasteen](https://github.com/codertheory/mangasteen)**, a cross-platform (Android / iOS) manga reader built with Kotlin Multiplatform.

## Sources

| Source | Language | NSFW | Notes |
|---|---|---|---|
| **MangaKatana** | EN | No | Full catalog, search, reader |
| **Mangago** | EN | No | Full catalog, search, reader — uses client-side image descrambling |

All sources are Ed25519-signed against [`publickey.pem`](./publickey.pem) at the repo root; the app verifies each source on every sync and rejects any `main.js` that's been tampered with.

## Adding this repo to Mangasteen

In the Mangasteen app:

1. Open **Browse → Extensions** tab.
2. Tap the **+** icon in the top right.
3. Paste this repo's URL: `https://github.com/codertheory/mangasteen-repo`
4. The app fetches available branches; pick `main` (or another branch if you know what you're doing).
5. Confirm — the sources show up on the **Sources** tab immediately.

You can change the branch later from the repository's details sheet (long-press the repo tile on the Extensions tab). Pull-to-refresh the branch list if a new branch was recently pushed.

## Contributing

Each source lives under `sources/<name>/` as a single file:

```
sources/mangaKatana/
  extension.json
  main.js               # editable, loaded directly by the host
  mangakatana.png       # bundled icon referenced by extension.json

sources/mangago/
  extension.json
  main.js               # editable, loaded directly by the host
```

The host only looks for `main.js` and has no module system — `require` / `import` throw at load. The host-exposed primitives (including `crypto.aesCbcDecrypt`) cover what our current sources need, so neither requires bundling. If you add a source that genuinely needs an npm package, keep the editable code at `main.src.js`, have esbuild emit `main.js`, and regenerate before every commit.

### Commands

```bash
npm install                          # one-time dev setup
npm run local -- <source>            # live HTTP against the real site
npm run test -- <source>             # offline — replay fixtures, no network
npm run test -- <source> <test-name> # filter to a single test from tests.json
npm run sign                         # re-sign every source after editing main.js
```

`<source>` defaults to `mangaKatana` when omitted.

**After editing any source's `main.js`, run `npm run sign` before committing.** The app rejects sources whose signature doesn't match the committed `publickey.pem`. See [`CLAUDE.md`](./CLAUDE.md#signing) for the full signing workflow.

### Offline testing

Each source ships a `fixtures/` directory that lets the runner replay recorded HTTP responses instead of hitting the network — fast, deterministic, and the only practical path for sites behind Cloudflare challenges (e.g. Mangago) that a plain axios client can't pass.

```
sources/<source>/fixtures/
  manifest.json          # [{ url, method, response }] — URL-to-file mapping
  tests.json             # [{ name, function, args }] — entries the suite runs
  expected/<name>.json   # (optional) golden output, deep-compared on match
  *.html                 # captured responses
```

Each `tests.json` entry dispatches `globalThis[function](...args)` and prints a summary. If `expected/<name>.json` exists the result is diffed against it — a mismatch prints `golden: DIFF` and fails the run. Missing golden files are skipped silently.

**Capturing a fixture:**

1. Load the target URL in your browser so any challenge cookies settle naturally.
2. `Cmd+Opt+U` (view source) → `Cmd+A`, `Cmd+C` → save to `sources/<source>/fixtures/<name>.html`.
3. Append to `manifest.json`: `{ "url": "<full URL>", "method": "GET", "response": "<name>.html" }`.
4. Add a `tests.json` entry calling the relevant function.
5. `npm run test -- <source> <test-name>` to verify that one, or omit the name for the whole suite.

The URL matcher canonicalizes query params (order and `+` vs `%20` don't matter), so the URL you paste doesn't have to byte-match what the source assembles internally.

**Seeding goldens:** copy a known-good test's printed output into `expected/<name>.json`; the runner diffs on every subsequent run and flags drift.

**Dev-only signal:** the runner sets `globalThis.OFFLINE` (`true` offline, `false` live, `undefined` in production). Sources should gate wall-clock-derived parsing behind this — otherwise captured strings like `"2 days ago"` resolve to `Date.now() - 2d` every run and drift forward as the fixture ages, breaking any golden compare on those fields. MangaKatana's `parseDate` applies this gate in its relative-time fallback.

### Writing a new source

Start from the [extension template](https://github.com/codertheory/Mangasteen-extension-template) — it has a dev loop (live + fixture-replay), type-checked host globals via `host-globals.d.ts`, and worked examples of every required function. Once your source is stable you can drop it under `sources/<name>/` here and add a matching `build:<name>` script.

### Contract summary

Each source exports six async functions on `globalThis`:

- `getPopularManga(page)` / `getLatestManga(page)` / `searchManga(query, page)` → `Manga[]`
- `getMangaDetails(url)` → `{ manga, chapters }` or `null`
- `getChapterList(url)` → `Chapter[]`
- `getPageList(url)` → `string[]` (image URLs, optionally with `#descrambler=…` fragments)

## License

MIT.
