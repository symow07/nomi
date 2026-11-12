import { describe, it, expect } from 'vitest';
import { onlyTypedLabels } from '../integration/authzHeld.js';

/**
 * The authorization walk's one exemption, judged on whole values (the re-verification's R4, 2026-11-11). Before, the
 * walk judged at most twelve shapes per column, each cut at 160 characters: a reference to the other workspace sitting
 * after a long `label` was forgiven. The walk's check (b) now reads every value and asks this, whole.
 */
const B_LABEL = 'b0000000-0000-4000-8000-000000000001';
const B_CONV = 'b0000000-0000-4000-8000-000000000002';
const A_OWN = 'a0000000-0000-4000-8000-000000000003';
const theirs = new Set([B_LABEL, B_CONV]);
const json = (o: unknown) => JSON.stringify(o);

describe('the walk\'s label exemption reads the whole value', () => {
  it('the tester\'s control: a label and a reference, short — counted', () => {
    expect(onlyTypedLabels('detail', json({ label: B_LABEL, conversation: B_CONV }), theirs)).toBe(false);
  });
  it('the tester\'s case: the reference after 160 characters of words — counted (it was forgiven)', () => {
    const v = json({ label: B_LABEL, padding: 'x'.repeat(160), conversation: B_CONV });
    expect(v.indexOf(B_CONV)).toBeGreaterThan(160);
    expect(onlyTypedLabels('detail', v, theirs)).toBe(false);
    expect(onlyTypedLabels('detail', json({ label: B_LABEL, padding: 'x'.repeat(5000), deep: [{ ref: `see ${B_CONV}` }] }), theirs)).toBe(false);
  });
  it('the allowlist audit as the app writes it — {phone, label} with the typed label alone — forgiven', () => {
    expect(onlyTypedLabels('detail', json({ phone: '+971500009999', label: B_LABEL }), theirs)).toBe(true);
    expect(onlyTypedLabels('label', B_LABEL, theirs)).toBe(true);
  });
  it('a label that holds the id beside other words, a label key holding a list, an id as a key — counted', () => {
    expect(onlyTypedLabels('label', `${B_LABEL} and more`, theirs)).toBe(false);
    expect(onlyTypedLabels('detail', json({ label: `x ${B_LABEL}` }), theirs)).toBe(false);
    expect(onlyTypedLabels('detail', json({ label: [B_LABEL] }), theirs)).toBe(false);
    expect(onlyTypedLabels('detail', json({ [B_CONV]: 'x' }), theirs)).toBe(false);
  });
  it('another column, a value that does not parse — counted; the other workspace\'s id absent — nothing to judge', () => {
    expect(onlyTypedLabels('assigned_to', B_LABEL, theirs)).toBe(false);
    expect(onlyTypedLabels('detail', `{"label": "${B_LABEL}", broken`, theirs)).toBe(false);
    expect(onlyTypedLabels('detail', json({ conversation: A_OWN }), theirs)).toBe(true);
  });
  it('upper case is the same id', () => {
    expect(onlyTypedLabels('detail', json({ label: B_LABEL, conversation: B_CONV.toUpperCase() }), theirs)).toBe(false);
  });
});
