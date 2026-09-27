import { stylesheetAt } from '../../src/api/web/layout.js';

/**
 * V1 close-out — the stylesheets are files (`/assets/<name>.<hash>.css`), so a
 * document carries links, not rules. A test that reads the rules a page is
 * drawn with reads them the way the browser does: through the links, from the
 * same function the route serves them with. Never from a copy.
 */

/** The addresses a document's stylesheet links point at. */
export const sheetLinks = (html: string): string[] =>
  [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]!);

/** The rules a document links, in order, as the route would serve them; '' for a link the route does not know. */
export const linkedCss = (html: string): string =>
  sheetLinks(html).map((href) => {
    const file = /^\/assets\/([^/]+)$/.exec(href)?.[1];
    return file ? (stylesheetAt(file)?.css ?? '') : '';
  }).join('\n');

/** A document as a browser has it once its stylesheets arrive: the markup, then its rules. */
export const withSheets = (html: string): string => `${html}\n${linkedCss(html)}`;
