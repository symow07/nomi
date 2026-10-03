#!/usr/bin/env node
/**
 * RET (0116) — RETIRED by 0126 (the owner's direction, 2026-10-04).
 *
 * This tool erased workspaces that never connected a channel, 90 days after
 * sign-up. It was built and never switched on. The retention model is not
 * "delete after 90 days": a customer's conversations are kept while the
 * workspace is active, and deleted when the customer asks (the owner deletes
 * them on the customer's page) or when the workspace closes (the owner closes
 * it on Your data). Nothing here lists, warns or erases any more:
 *
 *   · the daily warning job and its schedule are gone (src/main.ts, 0126);
 *   · the functions it read (retention_workspaces, claim_retention_warnings)
 *     are dropped (0126);
 *   · the `retention` switch cannot be set (tools/ops-flags.mjs refuses it;
 *     the database's `ops_flags_retention_retired` refuses it too).
 *
 * It refuses, whatever it is asked, and changes nothing.
 */
console.error('✗  tools/retention.mjs is retired (0126): nothing is erased after 90 days.\n'
  + '   A customer\'s data is deleted when they ask, by the owner on the customer\'s page;\n'
  + '   a workspace is erased when its owner closes it on Your data.\n'
  + '   An operator erasure under a request: tools/erase-buyer.mjs, tools/erase-workspace.mjs. Nothing was changed.');
process.exit(1);
