#!/usr/bin/env node
/** The pinned Node, or this stops: the first step of `npm run check` and `npm run trust` (tools/lib/pinned-node.mjs). */
import { requirePinnedNode } from './lib/pinned-node.mjs';

requirePinnedNode(process.argv[2] ?? 'this run');
