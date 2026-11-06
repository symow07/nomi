/**
 * THE OPENAI FORMAT, under the one client (2026-11-04).
 *
 * Every model call in Nomi is written in Anthropic's message format, and `src/llm/provider.ts` points that one client
 * at whichever company the installation pays. A provider that speaks only the OpenAI chat format gets this: the same
 * client, the same calls and the same guards after them, with the request and the answer translated at the fetch.
 * Nothing above this file knows.
 *
 * WHAT IT TRANSLATES. A request: system prompt, text, base64 images, `max_tokens`, `temperature`, a forced JSON schema
 * (`output_config.format`), thinking switched off. An answer: the words, why it stopped, and the tokens. A PDF has no
 * block here and throws — except a PDF, which is the chat format's `file` part (Block 1 #3, 2026-11-06), so `pdfReadable`
 * offers one at this address too (src/main.ts).
 *
 * TOKENS. `prompt_tokens` includes what was read from the cache, Anthropic's `input_tokens` does not, so the cached
 * part is moved aside: `usageOf` (src/llm/anthropic.ts) adds it back and prices it apart.
 *
 * A REFUSAL by the provider passes through untouched, status and body, so the SDK raises it as itself and
 * `classifyProviderFailure` reads the provider's own words.
 */

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Obj = Record<string, unknown>;

/** Which format a provider's address speaks. One address today: the rollback stays three variables, no fourth. */
export function speaksOpenAi(baseURL: string | null): boolean {
  if (!baseURL) return false;
  try { return new URL(baseURL).hostname.toLowerCase() === 'api.openai.com'; } catch { return false; }
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function partOf(block: unknown): Obj {
  const b = isObj(block) ? block : {};
  if (b['type'] === 'text') return { type: 'text', text: b['text'] };
  if (b['type'] === 'image' && isObj(b['source'])) {
    return { type: 'image_url', image_url: { url: `data:${String(b['source']['media_type'])};base64,${String(b['source']['data'])}` } };
  }
  // Block 1 #3 (2026-11-06) — a PDF is the chat format's `file` part, its bytes as a data address: the same document the
  // page reader and the papers reader send Anthropic (`pdfReadable` offers one here since this).
  if (b['type'] === 'document' && isObj(b['source']) && b['source']['media_type'] === 'application/pdf') {
    return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${String(b['source']['data'])}` } };
  }
  throw new Error(`the OpenAI format has no ${String(b['type'])} block here`);
}

/** The request, as the OpenAI chat format asks it. */
export function toChatCompletion(body: Obj): Obj {
  const system = body['system'];
  const said = typeof system === 'string' ? system : Array.isArray(system) ? system.map((s: Obj) => String(s['text'])).join('\n') : '';
  const messages = (body['messages'] as readonly Obj[]).map((m) => ({
    role: m['role'],
    content: typeof m['content'] === 'string' ? m['content'] : (m['content'] as readonly unknown[]).map(partOf),
  }));
  const format = isObj(body['output_config']) && isObj(body['output_config']['format']) ? body['output_config']['format'] : null;
  const thinking = isObj(body['thinking']) ? body['thinking']['type'] : null;
  return {
    model: body['model'],
    messages: [...(said ? [{ role: 'system', content: said }] : []), ...messages],
    max_completion_tokens: body['max_tokens'],
    ...(body['temperature'] !== undefined ? { temperature: body['temperature'] } : {}),
    ...(thinking === 'disabled' ? { reasoning_effort: 'none' } : {}),
    ...(format && format['type'] === 'json_schema'
      ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: format['schema'] } } }
      : {}),
  };
}

const STOPS: Readonly<Record<string, string>> = { stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' };

/** The answer, as the client reads it. A refusal has no words: `readWriterOutput` hands that turn to a person. */
export function fromChatCompletion(answer: Obj): Obj {
  const choice = (Array.isArray(answer['choices']) ? answer['choices'][0] : null) as Obj | null;
  const message = isObj(choice?.['message']) ? choice['message'] : {};
  const refused = typeof message['refusal'] === 'string' && message['refusal'] !== '';
  const words = !refused && typeof message['content'] === 'string' ? message['content'] : '';
  const usage = isObj(answer['usage']) ? answer['usage'] : {};
  const details = isObj(usage['prompt_tokens_details']) ? usage['prompt_tokens_details'] : {};
  const prompt = Number(usage['prompt_tokens'] ?? 0);
  const cached = Math.min(Number(details['cached_tokens'] ?? 0), prompt);
  return {
    id: answer['id'] ?? 'chat', type: 'message', role: 'assistant', model: answer['model'],
    stop_reason: refused ? 'refusal' : STOPS[String(choice?.['finish_reason'])] ?? 'end_turn',
    stop_sequence: null,
    content: words ? [{ type: 'text', text: words }] : [],
    usage: { input_tokens: prompt - cached, output_tokens: Number(usage['completion_tokens'] ?? 0), cache_read_input_tokens: cached },
  };
}

/** The client's fetch for such a provider: the address, the key and the shape are its own. */
export function openAiFetch(baseURL: string, apiKey: string, base: FetchLike = fetch): FetchLike {
  return async (_input, init) => {
    const res = await base(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(toChatCompletion(JSON.parse(String(init?.body)) as Obj)),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (!res.ok) return res;
    return new Response(JSON.stringify(fromChatCompletion((await res.json()) as Obj)),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** Is this Anthropic's own API, as opposed to another company's address that speaks its format? */
export function isAnthropicsOwn(baseURL: string | null): boolean {
  if (!baseURL) return false;
  try { return new URL(baseURL).hostname.toLowerCase() === 'api.anthropic.com'; } catch { return false; }
}

/**
 * ANTHROPIC'S OWN ADDRESS, as the fallback: the forced schema stays. No sampling parameter: its current Haiku answers
 * any with a 400, and a 400 does not fail over (`failureCounts`), so every call that reached it would be lost. Low effort,
 * the setting it was measured at. And the model runs in the United States, where the privacy page says the text goes.
 */
export function anthropicsOwnFetch(base: FetchLike = fetch): FetchLike {
  return (input, init) => {
    if (typeof init?.body !== 'string') return base(input, init);
    const { temperature: _dropped, output_config: config, ...rest } = JSON.parse(init.body) as Obj;
    const output_config = { ...(isObj(config) ? config : {}), effort: 'low' };
    return base(input, { ...init, body: JSON.stringify({ ...rest, output_config, inference_geo: 'us' }) });
  };
}

/** A forced JSON schema is asked of the model only where the provider's format is known to take one. */
export function withoutOutputFormat(base: FetchLike = fetch): FetchLike {
  return (input, init) => {
    if (typeof init?.body !== 'string' || !init.body.includes('"output_config"')) return base(input, init);
    const { output_config: _dropped, ...rest } = JSON.parse(init.body) as Obj;
    return base(input, { ...init, body: JSON.stringify(rest) });
  };
}
