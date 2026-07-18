import { z } from 'zod';
import type { Brand } from './brand.js';
import { type Result, ok, err } from './result.js';

export type BusinessId = Brand<string, 'BusinessId'>;
export type ClientId = Brand<string, 'ClientId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type AgentId = Brand<string, 'AgentId'>;

/** A validated email. The ONLY way to obtain one is parseEmail(). */
export type Email = Brand<string, 'Email'>;

// Shape-check, NOT RFC-4122 version enforcement: ids come from the database
// (gen_random_uuid → v4) and from legacy fixed rows like the n8n-era pilot
// business a0000000-…-01, whose version nibble is 0. zod's .uuid() rejects
// that — which 400'd the REAL tenant at the API boundary (found the first
// time the integration suite ran against a live DATABASE_URL).
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const uuidParser =
  <T>(label: string) =>
  (raw: string): Result<T, string> =>
    uuid.safeParse(raw).success
      ? ok(raw as T)
      : err(`invalid ${label}: ${JSON.stringify(raw)}`);

export const parseBusinessId = uuidParser<BusinessId>('BusinessId');
export const parseClientId = uuidParser<ClientId>('ClientId');
export const parseConversationId = uuidParser<ConversationId>('ConversationId');
export const parseProductId = uuidParser<ProductId>('ProductId');
export const parseOrderId = uuidParser<OrderId>('OrderId');

/**
 * Email parsing is deliberately conservative and deliberately NOT an LLM call.
 * Milestone 0: nothing in the old system ever captured an email, so order
 * confirmation rule 7 could never pass. A regex cannot hallucinate an address
 * the client never gave us — which is the whole point (principle 2).
 */
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function parseEmail(raw: string): Result<Email, string> {
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed)
    ? ok(trimmed as Email)
    : err(`invalid email: ${JSON.stringify(raw)}`);
}

/** Extract the first email present in free text, if any. */
export function extractEmail(text: string): Email | null {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (!m?.[0]) return null;
  const parsed = parseEmail(m[0]);
  return parsed.ok ? parsed.value : null;
}
