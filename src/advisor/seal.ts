import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * THE ADVISOR'S SEAL (docs/ADVISOR-MEMORY.md, D8; 0130). The advisor's stored words — questions, answers,
 * the facts they drew on, a conversation's title — are sealed with AES-256-GCM under ADVISOR_KEY, a key of
 * their own (not CREDENTIAL_KEY), so a database console, a dump or a backup holds only ciphertext. Each
 * sealed value is stored with its key's fingerprint (`sealed_with`), which names the key without revealing
 * it.
 *
 * Missing or wrong, the key never breaks the advisor: answers are given as ever, nothing new is kept, and a
 * stored conversation the key cannot open says so in a plain line (the page's, with the next PR). During a
 * rotation ADVISOR_KEY_PREVIOUS still opens what the old key sealed; whatever it opens is sealed again with
 * the current key when it is opened (`stale`), so no tool ever opens these words — and a conversation not
 * opened for 12 months is deleted anyway (D5). tests/parity/advisor-memory.test.ts holds that nothing under
 * tools/ imports this module or names the key.
 */

export type AdvisorKey = { readonly key: Buffer; readonly id: string };
export type AdvisorKeys = {
  readonly current: AdvisorKey | null;
  readonly previous: readonly AdvisorKey[];
  /** Why there is no current key: unset, or not a 64-hex key. */
  readonly problem: 'missing' | 'shape' | null;
};

const HEX64 = /^[0-9a-f]{64}$/i;
const keyOf = (hex: string): AdvisorKey => {
  const key = Buffer.from(hex, 'hex');
  return { key, id: createHash('sha256').update(key).digest('hex').slice(0, 12) };
};

/** The keys in force, from the environment. Never throws. */
export function advisorKeysFrom(env: Record<string, string | undefined>): AdvisorKeys {
  const now = (env['ADVISOR_KEY'] ?? '').trim();
  const was = (env['ADVISOR_KEY_PREVIOUS'] ?? '').trim();
  const previous = HEX64.test(was) ? [keyOf(was)] : [];
  if (!now) return { current: null, previous, problem: 'missing' };
  if (!HEX64.test(now)) return { current: null, previous, problem: 'shape' };
  return { current: keyOf(now), previous, problem: null };
}

/** Sealed with the current key, or null when there is none (then nothing is kept). */
export function sealAdvisor(keys: AdvisorKeys, plain: string): { readonly ciphertext: string; readonly sealedWith: string } | null {
  if (!keys.current) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.current.key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    ciphertext: ['a1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.'),
    sealedWith: keys.current.id,
  };
}

/**
 * Opened with the key that sealed it, or null: no such key here, or it does not open. `stale` when the key
 * was the previous one — then the caller seals it again with the current key.
 */
export function openAdvisor(keys: AdvisorKeys, ciphertext: string, sealedWith: string): { readonly plain: string; readonly stale: boolean } | null {
  const k = keys.current?.id === sealedWith ? keys.current : keys.previous.find((p) => p.id === sealedWith);
  if (!k) return null;
  const [v, iv, tag, data] = ciphertext.split('.');
  if (v !== 'a1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    return { plain, stale: k !== keys.current };
  } catch {
    return null;
  }
}
