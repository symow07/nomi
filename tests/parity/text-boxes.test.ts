import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { CONTROLS_CSS } from '../../src/api/web/controlsStyle.js';

/**
 * The text boxes (the owner, 2026-11-26): a text box grows with its words and is never pulled bigger by hand, a form's
 * fields share one width, a group of fields is not a drawn box, and the framed box under a conversation keeps its
 * contents a step in from its edge.
 */
describe('text boxes', () => {
  it('a text box grows with its words, from two lines to half the window, with no handle', () => {
    const rule = CONTROLS_CSS.match(/textarea:not\(\.bare\) \{[^}]*\}/)![0];
    expect(rule).toContain('field-sizing:content');
    expect(rule).toContain('resize:none');
    expect(rule).toContain('min-block-size:calc(2 * var(--control-field))');
    expect(rule).toContain('max-block-size:50vh');
    expect(rule).toContain('margin-block:0');
  });

  it('no stylesheet anywhere lets a text box be pulled by hand', () => {
    const dir = 'src/api/web';
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(`${dir}/${f}`, 'utf8'), f).not.toMatch(/resize:\s*(vertical|both|horizontal)/);
    }
  });

  it("a form's fields share one width; a search and the reply boxes keep their row", () => {
    expect(CONTROLS_CSS).toMatch(/:not\(\[type=search\], \.sp-form \*, \.approve \*, \.replyform \*[^)]*\) \{ max-inline-size:var\(--measure-prose\); \}/);
    expect(CONTROLS_CSS).toContain('.owner-shell .pform { max-inline-size:var(--measure-prose); }');
  });

  it('a group of fields is a heading, not a box; the conversation box holds its contents in from its edge', () => {
    expect(CONTROLS_CSS).toMatch(/fieldset:not\(\.bare\) \{ border:0; padding:0;/);
    expect(CONTROLS_CSS).toContain('.conversation-workspace .conv-acts:not(:empty) { padding-inline:var(--space-16); }');
  });
});
