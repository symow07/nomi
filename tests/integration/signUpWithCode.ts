import { expect } from 'vitest';

/**
 * G1 — open sign-up always goes through the e-mail code: the form, then the
 * six digits from the mail the installation's sender recorded. Answers the
 * /verify response (302 to /app/business, the session cookie set).
 */
type Res = { statusCode: number; headers: Record<string, unknown>; body: string };
export type Outbox = { to: string; subject: string; text: string }[];

export async function signUpWithCode(
  form: (url: string, fields: Record<string, string>, cookie?: string) => Promise<Res>,
  outbox: Outbox,
  fields: Record<string, string>,
): Promise<Res> {
  const asked = await form('/signup', fields);
  expect([asked.statusCode, asked.headers['location']], asked.body.slice(0, 300)).toEqual([302, '/verify']);
  const pending = ([] as string[]).concat(asked.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';
  const mail = [...outbox].reverse().find((m) => m.to === fields['email']);
  const code = mail?.subject.match(/\d{6}/)?.[0];
  expect(code, 'the code was mailed').toBeTruthy();
  return form('/verify', { code: code! }, pending);
}
