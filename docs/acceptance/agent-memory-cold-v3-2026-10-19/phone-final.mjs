// Run after phone-adopt.mjs's recorded INVALID_DOCUMENT, in the clean experiment sequence.
import { readFileSync, writeFileSync } from 'node:fs';
import { Workspace } from './repo/packages/core/dist/workspace.js';
import { runPhone } from './repo/packages/core/dist/phone-run.js';
const root = '/tmp/kaitu-cold-v3/phone-memory';
const path = root + '/projects/paperboat/STATUS.md';
writeFileSync(path, readFileSync(path, 'utf8').replace('updated: "2026-10-19"', 'updated: "2026-10-19T20:30:00+00:00"'));
console.log(JSON.stringify(await runPhone(new Workspace(root, { maintain: false }), { kind: 'agent', name: 'synthetic-cold-agent', spec: 1 }), null, 2));
