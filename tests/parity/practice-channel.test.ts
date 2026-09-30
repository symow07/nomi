import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { practiceAdapter } from '../../src/channels/practice.js';

/**
 * P3 — PRACTICE'S CHANNEL HAS NO NETWORK (docs/PRACTICE.md). A practice reply
 * runs the whole real pipeline and ends here, where it goes nowhere. What this
 * file may import is the whole guarantee, so the test reads it.
 */
const SRC = readFileSync(new URL('../../src/channels/practice.ts', import.meta.url), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('P3 · the practice adapter', () => {
  it('imports nothing that can reach a network — node:crypto for an id, and the contract\'s types', () => {
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./contract.js', 'node:crypto']);
    for (const call of ['fetch(', 'http', 'net.', 'dns', 'XMLHttpRequest', 'WebSocket', 'require(', 'import(']) {
      expect(code, call).not.toContain(call);
    }
  });

  it('accepts a text and a picture, each under an id that says it went nowhere; nothing arrives through it', async () => {
    const a = practiceAdapter();
    const text = await a.sendText('practice:x', 'hello');
    const media = await a.sendMedia!('practice:x', { url: 'https://img.test/a.jpg', caption: 'a' });
    for (const r of [text, media]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.providerMessageId).toMatch(/^practice:[0-9a-f-]{36}$/);
    }
    expect(a.verifyWebhook('{}', 'sha256=x')).toBe(false);
    expect(a.parseWebhook({ entry: [] })).toEqual([]);
    expect(a.kind).toBe('instagram');       // Practice runs as Instagram (P1): its window rules
    expect(a.sendMail).toBeUndefined();
  });

  it('is handed to a practice copy by the BUSINESS, before any real adapter is built', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/const drivers = practice \? practiceDrivers : await real\(tx, businessId\.value\);/);
    // both modes register the one handler: with channels, and in deployment mode
    expect(main.match(/boss\.work<DriveJob>\(QUEUES\.outbound, driveOutbound\(/g)?.length).toBe(2);
  });
});
