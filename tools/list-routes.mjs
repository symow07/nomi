#!/usr/bin/env node
/**
 * Print the app's GET route table, one path per line, params filled in.
 *
 * verify-remote.sh probes a REMOTE host and cannot introspect it, so the list
 * of paths to probe is derived HERE, from the same code that is deployed, and
 * never transcribed into the shell script. `--public` prints the deliberately
 * public ones instead, so the script can subtract them.
 *
 * Nothing is connected: registerWebApp only registers handlers, and no handler
 * runs. This never touches a database.
 */
import Fastify from 'fastify';

// DERIVED, never transcribed. A second copy of this list is how M40.2's deploy
// broke: the test's copy was updated and this one was not.
const { PUBLIC_ROUTES } = await import('../src/api/web/app.ts');
const PUBLIC = PUBLIC_ROUTES.filter((r) => r.method === 'GET').map((r) => r.url);

const app = Fastify({ logger: false });
const routes = [];
app.addHook('onRoute', (r) => {
  const ms = Array.isArray(r.method) ? r.method : [r.method];
  if (ms.includes('GET')) routes.push(r.url);
});

const { registerWebApp } = await import('../src/api/web/app.ts');
registerWebApp(app, {
  db: null, businessId: '00000000-0000-4000-8000-000000000000',
  accessCode: 'unused', provider: 'disabled', messagingEnabled: false,
});
await app.ready();

const fill = (u) => u.replace(/:([A-Za-z]+)/g, (_m, n) =>
  /token/i.test(n) ? 'x'.repeat(43)
  : /id$/i.test(n) ? '00000000-0000-0000-0000-000000000000' : 'x');

const wantPublic = process.argv.includes('--public');
for (const u of [...new Set(routes)].sort()) {
  if (PUBLIC.includes(u) === wantPublic) console.log(fill(u));
}
