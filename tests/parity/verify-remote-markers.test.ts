import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * verify-remote.sh checks that the owner's pages render by looking for a marker on each. Three of them had not existed
 * since the positioning rewrite, so the script failed against every deployment and nothing said so until someone ran
 * it. Its check is against a running app; this one holds its markers to the words the pages are made of.
 */
const script = readFileSync('.claude/skills/run-nomi/verify-remote.sh', 'utf8');
const catalogue = readFileSync('src/core/owner/i18n/messages.ts', 'utf8');
const TITLE = '<h1 class="page">';

/** A catalogue line whose English text begins with these words. */
const said = (words: string): boolean => catalogue.includes(`: '${words}`);
const markers = [...script.matchAll(/^check_page\s+(\S+)\s+'([^']+)'/gm)].map((m) => ({ path: m[1]!, marker: m[2]! }));

describe('verify-remote.sh · its markers are what the pages say', () => {
  it('finds the pages it checks', () => {
    expect(markers.map((m) => m.path)).toEqual(['/app', '/app/onboarding', '/app/onboarding/technical', '/app/inbox', '/app/business', '/app/knowledge']);
  });

  it('each title and label is in the catalogue', () => {
    const words = markers.filter((m) => !m.marker.startsWith('id=')).map((m) => m.marker.replace(TITLE, ''));
    expect(words.filter((w) => !said(w))).toEqual([]);
  });

  it('the check itself refuses the words the script used to look for', () => {
    expect(['Practice before launch', 'What she knows', 'Buyers'].filter(said)).toEqual([]);
  });

  it('never reads a page title from the rail: a marker that names a page is that page\'s heading', () => {
    expect(markers.filter((m) => /^(Inbox|Checklist|My business|What )/.test(m.marker))).toEqual([]);
  });
});
