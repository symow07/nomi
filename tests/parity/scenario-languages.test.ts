import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SCENARIOS } from '../../src/trust/scenarios.js';
import { SCENARIO_LANGUAGES } from '../../src/trust/scenarioLanguages.js';
import { evaluateScenario } from '../../src/trust/harness.js';

/**
 * The capability sweep (tools/capability-sweep.mjs) runs every golden scenario
 * in en, zh and ar. A scenario added without its three lines would silently
 * drop out of the one measurement that says whether a reply's sending depends
 * on the buyer's language — so the sweep refuses to run, and this fails first.
 */
const HAN = /\p{Script=Han}/u;
const ARABIC = /\p{Script=Arabic}/u;
/** Written in a language that is none of the three (Arabizi): each line is the same question. */
const IN_NONE_OF_THE_THREE = new Set(['identity-denial-arabizi-is-blocked']);

describe('every golden scenario has its words in en, zh and ar', () => {
  it('no scenario is missing, and no line names a scenario that is not there', () => {
    expect(Object.keys(SCENARIO_LANGUAGES).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  for (const s of SCENARIOS) {
    it(s.id, () => {
      const t = SCENARIO_LANGUAGES[s.id]!;
      expect(HAN.test(t.zh), t.zh).toBe(true);
      expect(ARABIC.test(t.ar), t.ar).toBe(true);
      expect(HAN.test(t.en) || ARABIC.test(t.en), t.en).toBe(false);
      // A scenario keeps its own words as its own language's line.
      if (IN_NONE_OF_THE_THREE.has(s.id)) return;
      const own = HAN.test(s.buyer.text) ? 'zh' : ARABIC.test(s.buyer.text) ? 'ar' : 'en';
      expect(t[own]).toBe(s.buyer.text);
    });
  }
});

describe('the sweep leaves the golden run as it was', () => {
  it('a scenario given its own words through the override decides exactly what it decides without', async () => {
    for (const s of SCENARIOS) {
      const plain = await evaluateScenario(s);
      const over = await evaluateScenario(s, { text: s.buyer.text });
      expect(over.outcome.capability, s.id).toBe(plain.outcome.capability);
      expect(over.outcome.result.decision.action.kind, s.id).toBe(plain.outcome.result.decision.action.kind);
      expect(over.report.passed, s.id).toBe(plain.report.passed);
    }
  });

  it('the tool never takes a connection URL as an argument, and asks only a database on this machine', () => {
    const tool = readFileSync('tools/capability-sweep.mjs', 'utf8');
    expect(tool).toContain("process.env['SWEEP_TRGM_URL']");
    expect(tool).toMatch(/\['127\.0\.0\.1', 'localhost'/);
    expect(tool).not.toMatch(/process\.argv[^\n]*(?:url|URL)/);
  });
});
