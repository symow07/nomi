import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * AN ORDER NEEDS NO E-MAIL, IN BOTH PROMPTS (#356 retired the gate's Rule 7,
 * 2026-10-15; the owner: "WhatsApp buyers do not hand over e-mail addresses to
 * place an order"). The writer's prompt said so at once. The analysis prompt
 * still listed e-mail in `missing_fields` and as part of confirming an order,
 * and its `next_logical_question` reaches the writer and the guard's stand-in
 * reply — so an e-mail question could still come back that way. Changed with
 * the live model check before and after (docs/REPORT-2026-10-15-PREVIEW-AND-ALARM.md).
 *
 * The rule: a line of either prompt that names e-mail says never to ask for it.
 */
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../prompts/${f}`, import.meta.url)), 'utf8');

describe('the prompts never invite asking for an e-mail', () => {
  it.each(['analysis.txt', 'response.txt'])('%s: every line that names e-mail forbids asking for it', (f) => {
    const lines = read(f).split('\n').filter((l) => /e-?mail/i.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l).toMatch(/\bnever\b/i);
  });

  it('the analysis example lists no e-mail among the missing fields', () => {
    const example = read('analysis.txt').split('\n').find((l) => l.includes('"missing_fields"'));
    expect(example).toBeDefined();
    expect(example).not.toMatch(/email/i);
  });
});
