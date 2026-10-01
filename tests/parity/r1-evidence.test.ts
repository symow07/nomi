import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sameWords } from '../../src/db/ownerWords.js';

/**
 * R1 — the ramp's evidence, counted right. Over Postgres: tests/integration/r1-evidence.test.ts.
 */
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('R1 · counted right', () => {
  it('1 · "as written" is after whitespace normalisation', () => {
    expect(sameWords('Which size  would\nyou like? ', 'Which size would you like?')).toBe(true);
    expect(sameWords('Which size?', 'Which colour?')).toBe(false);
  });
  it('3 · the guard event says whether the KEPT reply tripped', () => {
    expect(src('src/pipeline/turn.ts')).toContain("final: r.hold === 'guards_failed_twice',");
  });
  it('6 · every evidence query names the business, and the watermark is the system\'s demotion only', () => {
    const cap = src('src/pipeline/capability.ts');
    const body = cap.slice(cap.indexOf('export async function demotedSince'), cap.indexOf('/** confirm_order is permanently'));
    expect(body.match(/business_id = current_business_id\(\)/g)).toHaveLength(5);
    expect(body).toContain("and actor = 'system_self_demoted'");
  });
});
