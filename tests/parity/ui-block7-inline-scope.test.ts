import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';

/**
 * UI Block 7 · F34 fix round — an inline handler (`onclick="…"`) runs with the element, its form and `document` on its
 * scope chain, before the window. A bare name that `document` (or the element, or its form) also has is that
 * property, not the global: `URL` inside one is document.URL, a string, so `new URL(…)` threw and the Copy beside the
 * chat page's address did nothing, its fallback never reached (the tester, at debf2466). No inline handler in what the
 * app serves may use such a name bare; behaviour that needs one lives in the shared script.
 */

const SHADOWED = new Set([
  // document's own
  'URL', 'location', 'open', 'close', 'write', 'writeln', 'forms', 'images', 'links', 'anchors', 'scripts', 'embeds',
  'plugins', 'cookie', 'domain', 'referrer', 'title', 'body', 'head', 'all', 'documentElement', 'defaultView',
  'activeElement', 'hidden', 'visibilityState', 'readyState', 'fonts', 'designMode', 'dir', 'lastModified',
  'characterSet', 'contentType', 'doctype', 'implementation', 'children', 'firstChild', 'lastChild', 'parentNode',
  'createElement', 'evaluate', 'adoptNode', 'importNode',
  // the element's and its form's
  'form', 'name', 'value', 'type', 'id', 'style', 'dataset', 'action', 'method', 'elements', 'length', 'submit',
  'reset', 'click', 'focus', 'blur', 'remove', 'append', 'prepend', 'before', 'after', 'closest', 'matches',
  'contains', 'textContent', 'innerHTML', 'className', 'classList', 'disabled', 'labels', 'lang', 'translate',
]);
const KEYWORDS = new Set(['var', 'let', 'const', 'function', 'return', 'new', 'this', 'if', 'else', 'true', 'false',
  'null', 'undefined', 'typeof', 'void', 'event', 'window', 'try', 'catch']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Bare names in a handler's code: not after a dot, string literals taken out. */
function bare(code: string): string[] {
  const plain = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\$\{[^}]*\}/g, '0');
  return [...plain.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!).filter((n) => !KEYWORDS.has(n));
}

describe('F34 fix · no inline handler uses a name document shadows', () => {
  const handlers = files('src/api').flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/\son[a-z]+=\\?"([^"\\]*)\\?"/g)].map((m) => ({ file: f, code: m[1]! })));

  it('the scan finds the handlers there are (the confirm on asking buttons at least)', () => {
    expect(handlers.length).toBeGreaterThan(50);
    expect(bare('var v=new URL(b.dataset.copy,location.href).href')).toEqual(expect.arrayContaining(['URL', 'location', 'b', 'v']));
    expect(bare("return confirm(this.dataset.confirm)")).toEqual(['confirm']);
  });

  it('none names URL, location, open, close, forms or another property of document, the element or its form', () => {
    const bad = handlers.flatMap((h) => bare(h.code).filter((n) => SHADOWED.has(n)).map((n) => `${h.file}: ${n}`));
    expect([...new Set(bad)]).toEqual([]);
  });

  it('Copy is the shared script\'s: the buttons carry data only, the script makes the full link with window.URL and falls back to selecting', () => {
    const src = readFileSync('src/api/web/channels.ts', 'utf8');
    expect(src).toContain('data-copy="${esc(code)}"');
    expect(src).not.toMatch(/data-copy[^>]*onclick/);
    expect(LIVE_SCRIPT).toContain("closest('button[data-copy]')");
    expect(LIVE_SCRIPT).toContain('new window.URL(v, window.location.href)');
    expect(LIVE_SCRIPT).toContain("say('data-select')");
    expect(LIVE_SCRIPT).toContain("if (!cb || typeof cb.writeText !== 'function') return pick();");
    expect(LIVE_SCRIPT).toContain('cb.writeText(v).then(function () { say(\'data-said\'); }, pick)');
    expect(LIVE_SCRIPT).toContain('copying();');
  });
});
