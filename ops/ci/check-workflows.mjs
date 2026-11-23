#!/usr/bin/env node
// Supply-chain rules for .github/workflows (SECURITY-AUDIT SEC-54, SEC-74). Run in the Security workflow:
//   node ops/ci/check-workflows.mjs
//
// 1. Every `uses:` names a full 40-character commit SHA with the version in a comment
//    (`actions/checkout@<sha> # v7.0.1`), never a movable tag or branch. Dependabot updates both.
// 2. Every workflow sets a top-level `permissions:` block, so no job inherits the repository default.
// 3. Every actions/checkout step sets `persist-credentials: false`, so later steps (which run
//    dependency code) never find the token on disk.
// No dependencies on purpose: it runs before `npm ci`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.github/workflows';
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
const problems = [];

for (const f of files) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  const top = lines.findIndex((l) => /^permissions:/.test(l));
  if (top < 0) problems.push(`${f}: no top-level "permissions:" block`);
  else {
    // Write scopes go on the one job that needs them, never on the whole workflow.
    for (let j = top; j < lines.length && (j === top || /^\s+\S|^\s*$/.test(lines[j])); j++) {
      if (/:\s*write\b|write-all/.test(lines[j])) problems.push(`${f}:${j + 1}: top-level permissions grant write; grant it on the job instead`);
    }
  }

  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)(?:-\s+)?uses:\s*([^\s#]+)\s*(#.*)?$/);
    if (!m) return;
    const [, indent, ref, comment] = m;
    const where = `${f}:${i + 1}`;
    if (ref.startsWith('./')) return; // an action in this repository
    if (ref.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/.test(ref)) problems.push(`${where}: docker action not pinned by digest: ${ref}`);
      return;
    }
    if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref)) problems.push(`${where}: not pinned to a commit SHA: ${ref}`);
    else if (!comment || !/#\s*v\d+(\.\d+)*/.test(comment)) problems.push(`${where}: add the version as a comment (# vX.Y.Z): ${ref}`);

    if (/^actions\/checkout@/.test(ref)) {
      // The step's own keys are indented deeper than its "- uses:" dash (or at the same column as "uses:").
      const stepIndent = indent.length;
      let ok = false;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '' || l.trim().startsWith('#')) continue;
        const ind = l.match(/^\s*/)[0].length;
        if (ind <= stepIndent && /^\s*-\s/.test(l)) break; // next step
        if (ind < stepIndent) break; // left the step
        if (/^\s*persist-credentials:\s*false\s*$/.test(l)) ok = true;
      }
      if (!ok) problems.push(`${where}: actions/checkout without "persist-credentials: false"`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} workflow problem(s). See ops/ci/check-workflows.mjs.`);
  process.exit(1);
}
console.log(`${files.length} workflows: actions pinned to commit SHAs, permissions set, checkout credentials not kept.`);
