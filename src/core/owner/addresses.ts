/**
 * CC-25 — THE ADDRESS OF A CONVERSATION, written here and nowhere else.
 *
 * G5 — here rather than in the web layer, so an alert e-mail links to the
 * same place a page does (`src/pipeline/notify.ts` may not import the web
 * layer). `src/api/web/layout.ts` re-exports it.
 *
 * Every door into a conversation and every redirect back to one lands on its
 * newest message (`#latest`): the reply waiting for approval sits directly
 * under it, and so does the notice an action leaves. A conversation linked
 * any other way opens at its top — the header, and a whole transcript between
 * the owner and both. `tests/parity/conversation-landing.test.ts` finds every
 * other way.
 *
 * `before` is the "Earlier messages" door: the window before that cursor,
 * landing on the newest message IT shows. A cursor is digits, hex and `_`
 * (`src/db/transcript.ts`), so neither part ever puts a `%` into a page.
 */
export const conversationUrl = (conversationId: string, before?: string | null): string =>
  `/app/inbox/${encodeURIComponent(conversationId)}${before ? `?before=${encodeURIComponent(before)}` : ''}#latest`;
