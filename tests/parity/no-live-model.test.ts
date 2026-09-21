import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE SUITE DOES NOT TALK TO A MODEL.
 *
 * `validateEnv` refuses to boot without a shape-valid model key, so every
 * integration test that builds the production composition passes a dummy
 * ('test-key-not-real-just-shape-valid') to get past that check — and
 * `buildProduction` then hands the dummy to a REAL client. Nine of the twelve
 * files that boot it never scripted a model, so any inbound message reaching a
 * turn made a live HTTPS request to api.anthropic.com and came back 401.
 *
 * Nothing asserted on the result, which is why it went unnoticed: the suite
 * passed anyway, until it didn't. Two of five local runs failed in the e-mail
 * and day-one files, always with `invalid x-api-key` in the log — a test suite
 * that depended on the network, a credential, and a race with teardown.
 *
 * So this is the ratchet. A test that boots the composition must say what the
 * model does — a scripted fake when the turn should succeed, `offlineModels()`
 * when it should never be asked at all.
 */

const INT = fileURLToPath(new URL('../integration/', import.meta.url));

describe('no test reaches a real model', () => {
  const files = readdirSync(INT).filter((f) => f.endsWith('.test.ts'));
  const boots = files.filter((f) => readFileSync(INT + f, 'utf8').includes('buildProduction'));

  it('sanity: some tests do boot the whole composition', () => {
    expect(boots.length).toBeGreaterThan(5);
  });

  it('EVERY ONE of them says what the model does', () => {
    const silent = boots.filter((f) => !readFileSync(INT + f, 'utf8').includes('models:'));
    expect(
      silent,
      'these boot buildProduction without a models override, so the real client '
      + 'gets the dummy key and the suite talks to api.anthropic.com. Pass '
      + 'offlineModels(), or a scripted FakeAnalyzer/FakeReplyWriter.',
    ).toEqual([]);
  });

  it('and no test names a real model endpoint', () => {
    for (const f of files) {
      const src = readFileSync(INT + f, 'utf8');
      expect(src, `${f} names a live model host`).not.toMatch(/api\.anthropic\.com|api\.deepseek\.com|api\.openai\.com/);
    }
  });
});

describe('the unplugged model refuses rather than answering', () => {
  it('asking it anything throws, and the message says what to do instead', async () => {
    const { offlineModels } = await import('../pipeline/fakes.js');
    const { analyzer, replyWriter } = offlineModels();
    // A neutral answer would let a test quietly depend on a model nobody
    // scripted. This reproduces what those tests already got — a model that
    // does not answer — without the network.
    //
    // Called through the FUNCTION type rather than handed a cast-away object:
    // it refuses before it looks at anything, so an argument shaped to satisfy
    // the compiler would be a fixture that documents nothing.
    const ask = analyzer.analyze as () => Promise<never>;
    const say = replyWriter.write as () => Promise<never>;
    await expect(ask()).rejects.toThrow(/without scripting a model/);
    await expect(say()).rejects.toThrow(/FakeAnalyzer\/FakeReplyWriter/);
  });
});
