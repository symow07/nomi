#!/usr/bin/env node
/**
 * The OUTSIDE deploy watcher (the owner, 2026-10-16). Run by .github/workflows/deploy-drift.yml every 30 minutes.
 * It asks Railway which commit production runs, asks GitHub how far main has moved past it, and pings a Healthchecks
 * check ONLY when production is caught up. A missed ping is the alarm: Healthchecks alerts when the period and grace
 * pass with no ping. Nothing here runs inside Railway, and nothing here is the app's code.
 *
 * WHY IT EXISTS. From 2026-10-14 18:11 UTC Railway deployed nothing for a day and six merges, and nothing noticed.
 * The inside watcher (#363, 0167) can only watch once a deploy carries it in — the one thing that was not happening.
 *
 * "CAUGHT UP" IS MEASURED FROM THE OLDEST MERGE PRODUCTION LACKS, not from main's newest commit. Measuring from the
 * newest would let merges arriving less than an hour apart postpone the alarm for as long as they kept arriving —
 * exactly what an active day looks like. Here a merge that has not arrived after LAG_LIMIT_MIN keeps the check
 * quiet no matter how many merges follow it.
 *
 * WHICH WAY IT FAILS. Every failure of this job — Actions not running (the repo private and its minutes blocked,
 * a scheduled workflow disabled), a Railway token revoked, an API down, a bug here — means NO PING, and Healthchecks
 * alarms. It is loud in those directions. It is silent only if Healthchecks itself cannot alert. When it says
 * "behind" it also pings /fail with what it saw, so the alert names the commits instead of waiting out the grace.
 *
 * Environment (GitHub Actions secrets and the run's own token; never a command-line argument):
 *   RAILWAY_DEPLOY_WATCH_TOKEN  a Railway PROJECT token for the production environment (Project-Access-Token header)
 *   DEPLOY_DRIFT_PING_URL       the Healthchecks check's ping URL
 *   GITHUB_TOKEN, GITHUB_REPOSITORY   provided by Actions
 *   RAILWAY_SERVICE_NAME        the service to watch (default `nomi`)
 * `--dry-run` prints what it found and pings nothing.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** A merge production lacks for longer than this is the alarm. Railway's builds here have taken up to half an hour. */
export const LAG_LIMIT_MIN = 60;
/** How far back along main's first parents to look for production's commit before calling it lost. */
export const MAX_STEPS = 60;

/**
 * The verdict, pure. `chain` is main's first-parent history from the head backwards: [{ sha, at }], newest first.
 * Production's commit counts as found when either sha is a prefix of the other.
 */
export function driftVerdict(running, chain, now, limitMin = LAG_LIMIT_MIN) {
  if (!running || chain.length === 0) return { state: 'unknown', why: 'nothing to compare' };
  const r = running.toLowerCase();
  const same = (sha) => sha.toLowerCase().startsWith(r) || r.startsWith(sha.toLowerCase());
  const at = chain.findIndex((c) => same(c.sha));
  if (at === 0) return { state: 'current', lagMin: 0, missing: 0 };
  if (at === -1) {
    // Production runs a commit not within the last MAX_STEPS merges of main (or not on main at all): behind, and
    // by more than we can count. Measured from the oldest merge we looked at, so it is at least that late.
    const oldest = chain[chain.length - 1];
    return { state: 'behind', lagMin: Math.round((now - oldest.at) / 60_000), missing: chain.length, lost: true };
  }
  const firstMissing = chain[at - 1];           // the oldest merge production does not have
  const lagMin = Math.round((now - firstMissing.at) / 60_000);
  return { state: lagMin > limitMin ? 'behind' : 'deploying', lagMin, missing: at };
}

/** One GraphQL call to Railway with a project token. Throws on any error, so the job fails and does not ping. */
async function railway(token, query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Project-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors) throw new Error(`Railway answered ${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  return body.data;
}

/** The commit the newest SUCCESSFUL deployment of the service runs — the one serving traffic. */
export async function runningCommit(token, serviceName) {
  const { projectToken } = await railway(token, 'query { projectToken { projectId environmentId } }');
  const { project } = await railway(token,
    'query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }', { id: projectToken.projectId });
  const service = project.services.edges.map((e) => e.node).find((s) => s.name === serviceName);
  if (!service) throw new Error(`no service named ${serviceName} in this token's project`);
  const { deployments } = await railway(token,
    'query($input: DeploymentListInput!) { deployments(input: $input, first: 1) { edges { node { id status createdAt meta } } } }',
    { input: { projectId: projectToken.projectId, environmentId: projectToken.environmentId, serviceId: service.id, status: { in: ['SUCCESS'] } } });
  const node = deployments.edges[0]?.node;
  const sha = node?.meta?.commitHash;
  if (!sha) throw new Error('the newest successful deployment names no commit (not deployed from git?)');
  return { sha, deployedAt: node.createdAt };
}

/** Main's first-parent history from the head, newest first, until `running` is found or MAX_STEPS merges. */
export async function mainChain(repo, ghToken, running) {
  const get = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'nomi-deploy-drift', ...(ghToken ? { authorization: `Bearer ${ghToken}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return res.json();
  };
  const chain = [];
  let c = await get('commits/main');
  const r = running.toLowerCase();
  for (let i = 0; i < MAX_STEPS && c; i++) {
    chain.push({ sha: c.sha, at: Date.parse(c.commit.committer.date) });
    if (c.sha.toLowerCase().startsWith(r) || r.startsWith(c.sha.toLowerCase())) break;
    const parent = c.parents?.[0]?.sha;
    c = parent ? await get(`commits/${parent}`) : null;
  }
  return chain;
}

async function ping(url, suffix, text) {
  const res = await fetch(`${url.replace(/\/$/, '')}${suffix}`, { method: 'POST', body: text, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Healthchecks answered ${res.status}`);
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const token = process.env.RAILWAY_DEPLOY_WATCH_TOKEN;
  const pingUrl = process.env.DEPLOY_DRIFT_PING_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo || (!pingUrl && !dry)) {
    console.error('RAILWAY_DEPLOY_WATCH_TOKEN, GITHUB_REPOSITORY and DEPLOY_DRIFT_PING_URL are required. Nothing pinged.');
    process.exit(2);
  }
  const running = await runningCommit(token, process.env.RAILWAY_SERVICE_NAME || 'nomi');
  const chain = await mainChain(repo, process.env.GITHUB_TOKEN, running.sha);
  const v = driftVerdict(running.sha, chain, Date.now());
  const line = `production ${running.sha.slice(0, 7)} (deployed ${running.deployedAt}) · main ${chain[0]?.sha.slice(0, 7) ?? '?'} · `
    + (v.state === 'current' ? 'caught up'
      : `${v.lost ? `more than ${v.missing}` : v.missing} merge(s) behind, the oldest ${v.lagMin} min old (limit ${LAG_LIMIT_MIN})`);
  console.log(`${v.state}: ${line}`);
  if (dry) { console.log('dry run: nothing pinged'); return; }
  if (v.state === 'current' || v.state === 'deploying') await ping(pingUrl, '', line);
  else if (v.state === 'behind') { await ping(pingUrl, '/fail', line); process.exitCode = 1; }
  else { console.error('nothing to compare: not pinged'); process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(`deploy drift check failed, nothing pinged: ${e.message}`); process.exit(1); });
}
