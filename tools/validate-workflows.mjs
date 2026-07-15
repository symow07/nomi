#!/usr/bin/env node
/**
 * Static checks on the generated n8n workflows.
 * Run: node tools/validate-workflows.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'n8n');

const TRIGGERS = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.executeWorkflowTrigger',
]);

let errors = 0;
const fail = (f, msg) => { console.error(`  ✗ [${f}] ${msg}`); errors++; };

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  let wf;
  try {
    wf = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (e) {
    fail(file, `invalid JSON: ${e.message}`);
    continue;
  }

  const names = wf.nodes.map((n) => n.name);
  const set = new Set(names);

  // duplicate names — n8n addresses nodes by name, so dupes are fatal
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) fail(file, `duplicate node names: ${[...new Set(dupes)].join(', ')}`);

  // connections point at real nodes
  for (const [from, conn] of Object.entries(wf.connections)) {
    if (!set.has(from)) fail(file, `connection from unknown node "${from}"`);
    for (const output of conn.main ?? []) {
      for (const link of output ?? []) {
        if (!set.has(link.node)) fail(file, `"${from}" → unknown node "${link.node}"`);
      }
    }
  }

  // reachability from the trigger
  const triggers = wf.nodes.filter((n) => TRIGGERS.has(n.type)).map((n) => n.name);
  if (!triggers.length) fail(file, 'no trigger node');
  const seen = new Set(triggers);
  const queue = [...triggers];
  while (queue.length) {
    const cur = queue.shift();
    for (const output of wf.connections[cur]?.main ?? []) {
      for (const link of output ?? []) {
        if (!seen.has(link.node)) { seen.add(link.node); queue.push(link.node); }
      }
    }
  }
  for (const n of wf.nodes) {
    if (!seen.has(n.name)) fail(file, `unreachable node: "${n.name}"`);
  }

  // every embedded Code body must parse as JS
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    try {
      new Function(n.parameters.jsCode);
    } catch (e) {
      fail(file, `syntax error in Code node "${n.name}": ${e.message}`);
    }
  }

  // n8n expressions must start with '=' to be evaluated
  const walk = (o, path = '') => {
    if (typeof o === 'string') {
      if (o.includes('{{') && !o.startsWith('=')) {
        fail(file, `expression not prefixed with "=" at ${path}: ${o.slice(0, 60)}`);
      }
    } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    }
  };
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.code') walk(n.parameters, n.name);
  }

  const codeCount = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code').length;
  console.log(`  ✓ ${file.padEnd(28)} ${String(wf.nodes.length).padStart(2)} nodes, ${codeCount} code, all reachable`);
}

console.log(errors ? `\n${errors} problem(s) found.` : '\nAll workflows valid.');
process.exit(errors ? 1 : 0);
