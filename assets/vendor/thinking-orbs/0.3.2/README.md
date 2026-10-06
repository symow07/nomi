# thinking-orbs 0.3.2: the drawing core only

The advisor's thinking indicator is drawn by the drawing core of [`thinking-orbs`](https://www.npmjs.com/package/thinking-orbs) (Jakub Antalik, MIT; the licence is `LICENSE` here, verbatim). It was vendored on 2026-10-07.

## What is here, and where it came from

- `index-B8WsUNf5.js` is the package's `dist/index-B8WsUNf5.js`, byte for byte. It is the geometry of the nine states and the 2D-canvas painter. It imports nothing: no React, no DOM and no network, only `Math` and the canvas it is handed.
- `engine.es.js` is the package's `dist/engine.es.js`, byte for byte. It is the package's own `thinking-orbs/engine` entry, and it records the core's short export names. The advisor's script uses three of them:
  - `M` is `MODE_FRAMES`;
  - `p` is `paintFrame`;
  - `r` is `resolvePreset`.

  This file is not served. It is kept so a test can hold the script to those names.
- `LICENSE` is the package's `LICENSE`, verbatim.

| | SHA-256 |
|---|---|
| `thinking-orbs-0.3.2.tgz`, as published (npm integrity `sha512-QZFeBaPEzqhjiZoXy961EvDgaXk2WgXacF3Rbz+Sj5IfzDzBvTC86vdREUHniBffYibJFKSwbfllxLUdI/Xv6g==`, matched) | `2032b34cf1c336c395c65d46803eb5830b7e79064986ccde5c7308fdb4a43080` |
| `index-B8WsUNf5.js` | `4b43963f6409d310b9d80e592d4fb0f1435884a59d0c252f6f1b75926c09b949` |
| `engine.es.js` | `e7dc939abf68eb2890f1a3ed49f129185e04ca690dee905b05820ed27adbf209` |
| `LICENSE` | `915a283980628a0ca9e7b423ebafc6f3a0fa1e630ff17d34e59034808d92011c` |

`tests/parity/advisor-orb.test.ts` holds these digests. A changed byte fails it.

## Why vendored, not an npm dependency

The package's main entry is a React component, and it names React as a peer dependency, which npm installs on its own. The owner's rule (2026-10-07) is no React and no new build step. So only the core is kept, and no React reaches the app, its server or the browser.

The core is 26,541 bytes, 7,059 gzipped. It is served at an address named by its content (`/assets/orb.<hash>.js`, `assetAt` in `src/api/web/layout.ts`), cached for good. No page links it. The one script (`liveScript.ts`) imports it only on the advisor's page, when the question box is first focused or a question is sent. So it plays no part in drawing any page.

## Upgrading

Put the new version beside this one, with its own folder, digests and this note. Check that its core still imports nothing, and that `engine.es.js` still maps the three names. Then point `layout.ts` at it.
