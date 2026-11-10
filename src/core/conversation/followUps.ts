/** Fixed owner words. Saving a rule never grants permission to send. */
export type FollowUpRule = {
  readonly enabled: boolean;
  readonly delayDays: number;
  readonly wording: string;
};
export const DEFAULT_FOLLOW_UP_RULE: FollowUpRule = { enabled: false, delayDays: 2, wording: '' };
export type FollowUpRuleError = 'delay' | 'wording';
export function readFollowUpRule(input: { enabled?: unknown; delayDays?: unknown; wording?: unknown }):
  { readonly ok: true; readonly rule: FollowUpRule } | { readonly ok: false; readonly reason: FollowUpRuleError } {
  const days = String(input.delayDays ?? '');
  if (!/^[1-7]$/.test(days)) return { ok: false, reason: 'delay' };
  const enabled = input.enabled === true || input.enabled === '1';
  const wording = typeof input.wording === 'string' ? input.wording : '';
  if ([...wording].length > 500 || (enabled && !wording.trim())) return { ok: false, reason: 'wording' };
  return { ok: true, rule: { enabled, delayDays: Number(days), wording } };
}
