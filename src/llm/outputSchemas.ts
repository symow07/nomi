/**
 * THE TWO ANSWERS THE PROMPTS ASK FOR, as schemas, so a provider that can be held to one is (2026-11-04).
 *
 * `prompts/response.txt` and `prompts/analysis.txt` ask for JSON in words; a model can answer with something else, and
 * the turn then has nothing it can read. Strict: every field required, nothing added, and a field the prompt asks for
 * that is not here would never come back, so `tests/parity/openai-format.test.ts` holds each schema to its prompt.
 */

type Schema = Readonly<Record<string, unknown>>;

const obj = (properties: Readonly<Record<string, Schema>>): Schema =>
  ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str: Schema = { type: 'string' };
const bool: Schema = { type: 'boolean' };
const num: Schema = { type: 'number' };
const strs: Schema = { type: 'array', items: str };
const orNull = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });
const oneOf = (...values: readonly string[]): Schema => ({ type: 'string', enum: values });

export const WRITER_SCHEMA: Schema = obj({
  reply_text: str,
  attach_product_image: bool,
  tone: oneOf('warm', 'professional', 'direct'),
  phase_action: oneOf('maintain', 'advance', 'confirm_order'),
});

export const ANALYSIS_SCHEMA: Schema = obj({
  wants_person: bool,
  wants_deletion: bool,
  procedure_started: orNull(str),
  language: obj({ detected: str, confidence: num, script: str, formality: str, reply_in: str }),
  signals: obj({
    is_greeting: bool, is_question: bool, has_product_mention: bool, has_quantity_mention: bool,
    has_price_question: bool, urgency: str, sentiment: str,
  }),
  intent: obj({
    primary_intent: str,
    product_mention_raw: orNull(str),
    product_candidates: {
      type: 'array',
      items: obj({ product_id: orNull(str), product_name: str, confidence: num, match_method: str }),
    },
    quantity_mentioned: orNull({ type: 'integer' }),
    quantity_unit: orNull(str),
    customization_requested: bool,
    customization_details: orNull(str),
    timeline_mentioned: orNull(str),
    missing_fields: strs,
    next_logical_question: orNull(str),
  }),
  phase: obj({
    current_phase_valid: bool, recommended_phase: str, phase_change_reason: orNull(str),
    can_advance: bool, advance_blocked_by: strs,
  }),
});
