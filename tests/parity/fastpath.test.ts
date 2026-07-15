import { describe, it, expect } from 'vitest';
import { detectFastPath } from '../../src/core/conversation/fastpath.js';
import { emptyState } from './fixtures.js';

describe('fast path (0 AI calls)', () => {
  const pendingProduct = emptyState({ pendingQuestion: 'product_confirmation' });
  const pendingOrder = emptyState({ pendingQuestion: 'order_confirmation' });

  it('"yes" + pending product confirmation → confirms product, advances', () => {
    const r = detectFastPath('yes', pendingProduct);
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.type).toBe('product_confirmed_yes');
      expect(r.stateChanges.productConfirmedByClient).toBe(true);
      expect(r.stateChanges.pendingQuestion).toBeNull(); // question resolved
      expect(r.phaseTarget).toBe('qualification');
    }
  });

  it('Arabic "نعم" matches, and the reply is in the client’s language', () => {
    const r = detectFastPath('نعم', { ...pendingProduct, preferredLanguage: 'ar' });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.reply).toMatch(/[؀-ۿ]/); // Arabic script
  });

  it('"no" clears the identified product and asks again', () => {
    const r = detectFastPath('no', pendingProduct);
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.type).toBe('product_confirmed_no');
      expect(r.stateChanges.clearIdentifiedProduct).toBe(true);
    }
  });

  it('"yes" + pending ORDER confirmation → triggers the close', () => {
    const r = detectFastPath('yes', pendingOrder);
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.triggerOrderConfirmation).toBe(true);
      expect(r.phaseTarget).toBe('confirmation');
    }
  });

  it('"yes" with NO pending question does not fire', () => {
    expect(detectFastPath('yes', emptyState()).matched).toBe(false);
  });

  it('a sentence carries new information and must go to full analysis', () => {
    expect(detectFastPath('yes I want 500 of them', pendingProduct).matched).toBe(false);
  });
});
