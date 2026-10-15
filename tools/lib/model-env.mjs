/**
 * 0166 — `--fallback` for the tools that measure a model (capability-sweep, check-person-model,
 * check-language-release): the fallback provider's settings (`LLM_FALLBACK_*`) in the primary's place, so the same run
 * measures the fallback ALONE and its numbers sit beside the primary's. Null when they are not all three set; the
 * tool says so and stops. The settings are checked as the app checks them (`llmProviderFrom`), after this.
 */
export function modelEnvFor(argv, env) {
  if (!argv.includes('--fallback')) return env;
  const base = env.LLM_FALLBACK_BASE_URL?.trim(); const key = env.LLM_FALLBACK_API_KEY?.trim(); const model = env.LLM_FALLBACK_MODEL?.trim();
  if (!base || !key || !model) return null;
  return { ...env, LLM_BASE_URL: base, LLM_API_KEY: key, LLM_MODEL: model };
}
