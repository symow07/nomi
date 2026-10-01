#!/usr/bin/env node
/**
 * BILL (0117) — the operator's billing tool.
 *
 *   railway run --service nomi -- node tools/billing.mjs                                  # every billed workspace
 *   railway run --service nomi -- node tools/billing.mjs plans                            # the plans
 *   railway run --service nomi -- node tools/billing.mjs plan-set starter --price price_… --name "Starter" --customers 100 [--seats 3] [--assistants 2] [--position 1] --by "<you>" --yes
 *   railway run --service nomi -- node tools/billing.mjs plan-off starter --by "<you>" --yes
 *   railway run --service nomi -- node tools/billing.mjs grant-trial <business-id> --days 14 --by "<you>" --yes
 *   railway run --service nomi -- node tools/billing.mjs exempt|unexempt <business-id> --by "<you>" --yes
 *   railway run --service nomi -- node tools/billing.mjs trial-default <days|off> --by "<you>" --yes
 *
 * A plan's price is read from Stripe (STRIPE_SECRET_KEY in the service's own
 * environment, after `npm run build`) — never typed, so the page can never
 * show one price while Stripe charges another. A trial is granted on request
 * (the owner's instruction, 2026-10-01) until trial-default folds it into
 * self-serve. The switch that asks for a card before the first channel is
 * tools/ops-flags.mjs --set billing_required --all. Dry run unless --yes.
 * Reads MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const int = (v) => (v === undefined ? undefined : Number(v));
const [verb, target] = [process.argv[2], process.argv[3]];
const by = arg('--by'); const yes = process.argv.includes('--yes');
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const op = await import('./lib/operator.mjs');
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
const done = (r, said) => { console.log(said[r] ?? `Nothing was changed (${r}).`); if (!['set', 'off', 'granted', 'exempt', 'billed'].includes(r)) process.exitCode = 2; };
try {
  if (!verb || verb.startsWith('--')) {
    const on = (await client.query(`select exists (select 1 from ops_flags where flag = 'billing_required' and cleared_at is null) as on`)).rows[0].on;
    const def = (await client.query(`select self_serve_trial_days from billing_settings where id`)).rows[0]?.self_serve_trial_days ?? null;
    console.log(`Card before the first channel: ${on ? 'ON' : 'off'} · self-serve trial: ${def ? `${def} days` : 'on request only'}.`);
    for (const r of await op.listBilling(client)) {
      console.log(`  ${r.id}  ${r.name}  ${r.exempt_by ? `EXEMPT (${r.exempt_by})` : `${r.status}${r.plan_id ? ` · ${r.plan_id}` : ''}${r.card_saved_at ? ' · card' : ''}${r.trial_days ? ` · trial ${r.trial_days}d (${r.trial_granted_by})` : ''}${r.trial_ends_at ? ` · ends ${new Date(r.trial_ends_at).toISOString().slice(0, 10)}` : ''}`}  · ${r.customers} customers this month`);
    }
    process.exit(0);
  }
  if (verb === 'plans') {
    for (const p of await op.listPlans(client)) console.log(`  ${p.id}  ${p.name}  ${p.amount_minor} ${p.currency}/${p.period}  ${p.customers_a_month} customers${p.seats ? ` · ${p.seats} seats` : ''}${p.assistants ? ` · ${p.assistants} assistants` : ''}  ${p.stripe_price_id}${p.active ? '' : '  (off)'}`);
    process.exit(0);
  }
  if (!yes) { console.log(`Dry run: would ${verb} ${target ?? ''}. Add --by "<you>" --yes.`); process.exit(0); }
  if (verb === 'plan-set') {
    const { stripeConfigFrom, stripeClient } = await import('../dist/billing/stripe.js');
    const cfg = stripeConfigFrom(process.env);
    if (!cfg) { console.error('✗  STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are not set here. Run inside: railway run --service nomi -- …'); process.exit(2); }
    const price = await stripeClient(cfg).price(String(arg('--price') ?? ''));
    if (!price.ok) { console.error(`✗  Stripe did not give that price: ${price.error}. Nothing was changed.`); process.exit(2); }
    done(await op.setPlan(client, { id: target, name: arg('--name'), price: price.value, customers: int(arg('--customers')),
      seats: int(arg('--seats')), assistants: int(arg('--assistants')), position: int(arg('--position')), by }),
    { set: `✓ ${target}: ${price.value.amountMinor} ${price.value.currency} a ${price.value.interval}, as Stripe holds it.`, invalid: 'Usage: plan-set <id> --price price_… --name … --customers N [--seats N] [--assistants N] --by … --yes (the price must be recurring and active). Nothing was changed.' });
  } else if (verb === 'plan-off') {
    done(await op.planOff(client, { id: target, by }), { off: `✓ ${target} is no longer on offer; workspaces on it keep it.`, none: `No plan ${target} on offer.` });
  } else if (verb === 'grant-trial') {
    done(await op.grantTrial(client, { businessId: target, days: int(arg('--days')), by }),
      { granted: `✓ ${target}: a free trial of ${arg('--days')} days, from its first channel connected.`, subscribed: 'Its subscription exists already: change the trial in Stripe. Nothing was changed.',
        not_self_serve: 'Not a workspace that signed itself up: never billed. Nothing was changed.', none: `No workspace ${target}.`, invalid: 'Usage: grant-trial <business-id> --days 1–90 --by … --yes.' });
  } else if (verb === 'exempt' || verb === 'unexempt') {
    done(await op.setExempt(client, { businessId: target, by, exempt: verb === 'exempt' }),
      { exempt: `✓ ${target} is not billed and never held for payment.`, billed: `✓ ${target} is billed like any workspace that signed itself up.`, none: `No workspace ${target}.` });
  } else if (verb === 'trial-default') {
    done(await op.setTrialDefault(client, { days: target === 'off' ? null : int(target), by }),
      { set: target === 'off' ? '✓ trials are on request only.' : `✓ every workspace choosing a plan from now gets ${target} free days.`, invalid: 'Usage: trial-default <1–90|off> --by … --yes.' });
  } else {
    console.error('Usage: see the top of tools/billing.mjs.'); process.exitCode = 2;
  }
} finally {
  await client.end().catch(() => undefined);
}
