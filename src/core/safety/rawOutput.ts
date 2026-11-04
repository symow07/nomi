/**
 * THE WRITER'S WORDS, AND NOTHING OF ITS JSON (2026-11-04).
 *
 * The writer is told to answer with one JSON object. A model can answer with the
 * words and then the object, or the object cut short, or nothing at all, and the
 * old reading sent all of that on: either the raw text, field names and all, or
 * a stock "Thanks for your message" nobody wrote for this customer.
 *
 * `readWriterOutput` takes the customer's words out or answers null, and null is
 * a person's turn (`not_answered`, src/pipeline/turn.ts). `carriesOurJson` is the
 * last net, read again on the finished reply and at the send gate: it names our
 * own fields, so what an owner typed in braces is never mistaken for one.
 *
 * Both lists of what they read are in tests/parity/raw-output.test.ts.
 */

const stripFences = (s: string): string => s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

/** An object opening, however it is quoted: where trailing JSON starts. */
const JSON_START = /\{\s*["'“”]?[A-Za-z_][A-Za-z0-9_]*["'“”]?\s*:/;

/** Our fields without the brace: `"tone":"warm"}` after a line of words. */
const OUR_FIELDS = /["“”]?(?:reply_text|attach_product_image|phase_action|wants_person|wants_deletion|next_logical_question)["“”]?\s*:|["“”](?:tone|language|intent)["“”]\s*:/;

const REPLY_TEXT = /"reply_text"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/;

function parsed(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

function buriedReply(s: string): string | null {
  const m = REPLY_TEXT.exec(s);
  if (!m) return null;
  const text = parsed(`"${m[1]}"`);
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

function beforeAnyJson(s: string): string {
  const starts = [JSON_START.exec(s)?.index, OUR_FIELDS.exec(s)?.index].filter((i): i is number => i !== undefined);
  return (starts.length ? s.slice(0, Math.min(...starts)) : s).trim();
}

/** The customer's words in what the writer returned, or null when nothing can be sent. */
export function readWriterOutput(text: string | null | undefined, stopReason?: string | null): string | null {
  if (stopReason === 'refusal' || stopReason === 'max_tokens') return null;
  const raw = stripFences(text ?? '');
  if (!raw) return null;
  const whole = parsed(raw);
  if (typeof whole === 'object' && whole !== null) {
    const said = (whole as Record<string, unknown>)['reply_text'];
    if (typeof said !== 'string') return null;
    return beforeAnyJson(said) || null;
  }
  return beforeAnyJson(buriedReply(raw) ?? raw) || null;
}

/** Does this finished reply still carry our JSON? Then it must not reach a customer. */
export function carriesOurJson(reply: string): boolean {
  return OUR_FIELDS.test(reply);
}
