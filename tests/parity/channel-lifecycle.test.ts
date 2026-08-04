import { describe, it, expect } from 'vitest';
import {
  channelLifecycle, isConnected, canActivateChannel, type ChannelFacts,
} from '../../src/core/channel/lifecycle.js';

/**
 * M20.3.1 — one truth about the channel. The defect this closes: My factory
 * said "WhatsApp: Not connected" in one section and "Lily can start whenever
 * you say so" in the next, because activation readiness only counted whether a
 * `channels` row existed.
 */
const AT = new Date('2026-08-04T09:00:00Z');
const facts = (over: Partial<ChannelFacts> = {}): ChannelFacts => ({
  hasChannel: true, status: 'connected', credentialActive: true,
  providerConfigured: true, activatedAt: null, disconnectedAt: null, ...over,
});

describe('M20.3.1 · the four states, from facts the database already holds', () => {
  it('A — a fresh factory is not connected, and cannot activate', () => {
    const fresh = facts({ hasChannel: false, status: null, credentialActive: false });
    expect(channelLifecycle(fresh)).toBe('not_connected');
    expect(canActivateChannel(fresh)).toBe(false);
  });

  it('B — connected with working credentials is READY, and only then activatable', () => {
    expect(channelLifecycle(facts())).toBe('ready');
    expect(canActivateChannel(facts())).toBe(true);
  });

  it('C — connected AND turned on by the owner is ACTIVE', () => {
    const live = facts({ activatedAt: AT });
    expect(channelLifecycle(live)).toBe('active');
    expect(canActivateChannel(live), 'an active channel is already on').toBe(false);
  });

  it('D — stopped after having worked is PAUSED, never "not connected"', () => {
    // This is the exact rollback state that used to read as ready.
    const paused = facts({ status: 'disconnected', activatedAt: null, disconnectedAt: AT });
    expect(channelLifecycle(paused)).toBe('paused');
    expect(canActivateChannel(paused)).toBe(false);
  });

  it('the row-count bug: a channel row exists in EVERY state — existence proves nothing', () => {
    for (const f of [
      facts({ status: 'disconnected', disconnectedAt: AT }),
      facts({ credentialActive: false }),
      facts({ providerConfigured: false }),
    ]) {
      expect(f.hasChannel, 'the row is present').toBe(true);
      expect(canActivateChannel(f), 'yet it must not be activatable').toBe(false);
    }
  });

  it('each missing requirement alone is enough to refuse', () => {
    expect(isConnected(facts({ hasChannel: false }))).toBe(false);
    expect(isConnected(facts({ status: 'disconnected' }))).toBe(false);
    expect(isConnected(facts({ status: 'needs_attention' }))).toBe(false);
    expect(isConnected(facts({ credentialActive: false }))).toBe(false);
    expect(isConnected(facts({ providerConfigured: false }))).toBe(false);
    expect(isConnected(facts())).toBe(true);
  });

  it('a stale activation on a broken channel is NOT active — it is the underlying state', () => {
    // activated_at survives a credential going inactive or a provider being
    // removed; claiming "active" there would be the same lie in a new place.
    expect(channelLifecycle(facts({ activatedAt: AT, credentialActive: false }))).toBe('paused');
    expect(channelLifecycle(facts({ activatedAt: AT, providerConfigured: false }))).toBe('paused');
    expect(channelLifecycle(facts({ activatedAt: AT, status: 'disconnected', disconnectedAt: AT }))).toBe('paused');
  });

  it('never-connected and stopped are different answers, because the next step differs', () => {
    expect(channelLifecycle(facts({ hasChannel: false, status: null, credentialActive: false })))
      .not.toBe(channelLifecycle(facts({ status: 'disconnected', disconnectedAt: AT })));
  });

  it('is a pure function of its input — same facts, same answer', () => {
    const f = facts({ activatedAt: AT });
    expect(channelLifecycle(f)).toBe(channelLifecycle({ ...f }));
  });
});
