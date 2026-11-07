import { figuresIn } from '../conversation/figures.js';

/**
 * "DID TEACHING BREAK ANYTHING?" (Block 3 PR 3 of the finishing roadmap; 0230) — THE PURE PARTS. A saved case is a
 * customer's message and the answer a person gave or accepted (a draft approved or rewritten, a reply typed in a
 * conversation a person held). Before a change to what the assistant knows goes live — a taught fact, a procedure,
 * the voice, a price — the cases that touch the same words run again against the staged change, and the owner sees
 * what changed before keeping or reverting it.
 *
 * "Changed" is about the figures, not the prose: a model words a reply differently every time, so the comparison
 * that matters is whether the reply now carries different figures than the accepted answer did, or no reply where
 * there was one. Up to twenty cases per check; a re-run writes nothing a ramp could count.
 */
export const CASES_MAX = 20;
export const CHECK_KINDS = ['knowledge', 'procedure', 'voice', 'price'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type CaseRef = { readonly kind: 'draft' | 'message'; readonly id: string };
export type CaseCompared = {
  readonly changed: boolean;
  readonly reason: 'figures' | 'silent' | 'same';
  readonly figuresAccepted: readonly string[];
  readonly figuresReply: readonly string[];
};
export type CaseResult = CaseCompared & { readonly ref: CaseRef; readonly reply: string | null; readonly path: string; readonly touching: boolean };

/** The words a change touches: four letters or more (two Han characters), lower-cased, once each. */
export function touchWords(texts: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (!w) continue;
      const han = /^\p{Script=Han}+$/u.test(w);
      if ((han && w.length >= 2) || (!han && w.length >= 4)) out.add(w);
    }
  }
  return [...out].slice(0, 40);
}

const sorted = (xs: readonly string[]): string[] => [...new Set(xs.map((x) => x.replace(/[.,](?:0+)$/, '').replace(/,/g, '')))].sort();

/** What the re-run changed, in the terms that matter: the figures, or no reply where there was one. */
export function compareCase(accepted: string, reply: string | null): CaseCompared {
  const figuresAccepted = sorted(figuresIn(accepted));
  if (reply === null) return { changed: true, reason: 'silent', figuresAccepted, figuresReply: [] };
  const figuresReply = sorted(figuresIn(reply));
  const same = figuresAccepted.length === figuresReply.length && figuresAccepted.every((f, i) => f === figuresReply[i]);
  return { changed: !same, reason: same ? 'same' : 'figures', figuresAccepted, figuresReply };
}
