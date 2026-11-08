#!/usr/bin/env node
/**
 * Guard for the `server` deploy branch — docs/PLAN-SERVER-BRANCH.md §8.
 *
 * The invariant: `server` is ALWAYS an ancestor of `main` (never ahead, never
 * diverged). EC2 tracks origin/server and deploys with `git merge --ff-only`,
 * which is only safe while this holds. A commit made directly on `server`
 * without fast-forwarding `main` breaks every future deploy.
 *
 * Checks
 *   1. `server` is an ancestor of `main`.
 *   2. No forbidden path is tracked on `server` (secrets, sessions, .env, keys).
 *   3. Every cone directory that exists on `main` also exists on `server`
 *      (catches a promotion that silently dropped a directory).
 *
 * Run:  node tools/check-server-branch.cjs
 *       npm run test:server-branch
 *
 * In CI the refs must be fetched first:
 *   git fetch --no-tags origin \
 *     +refs/heads/main:refs/remotes/origin/main \
 *     +refs/heads/server:refs/remotes/origin/server
 *
 * Override refs for local experiments: FH_MAIN_REF / FH_SERVER_REF.
 */
'use strict';

const { execFileSync } = require('node:child_process');

const MAIN = process.env.FH_MAIN_REF || 'refs/remotes/origin/main';
const SERVER = process.env.FH_SERVER_REF || 'refs/remotes/origin/server';

/** Directories EC2 materialises via `git sparse-checkout` (plan §5.4). */
const CONE = ['bot', 'bot-control-api', 'webhook-server', 'shared', 'tools', 'assets'];

/** Never allowed in git on any branch. */
const FORBIDDEN = [
  /(^|\/)service-account\.json$/,
  /(^|\/)session_data_/,
  /(^|\/)\.env$/,
  /\.pem$/,
  /^Credentials\//,
  /SERVER-ACCESS-GUIDE\.md$/,
];

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function refExists(ref) {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(a, b) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS  ${msg}`);
}

for (const [label, ref] of [['main', MAIN], ['server', SERVER]]) {
  if (!refExists(ref)) {
    console.error(`FAIL  ${label} ref '${ref}' not found.`);
    console.error('      Fetch it first: git fetch origin main server');
    process.exit(1);
  }
}

const mainSha = git('rev-parse', '--short=7', MAIN);
const serverSha = git('rev-parse', '--short=7', SERVER);

// 1. One-way invariant.
if (isAncestor(SERVER, MAIN)) {
  pass(`${SERVER} (${serverSha}) is an ancestor of ${MAIN} (${mainSha})`);
} else if (isAncestor(MAIN, SERVER)) {
  fail(`${SERVER} is AHEAD of ${MAIN} — promote main first: git push origin main:server`);
} else {
  fail(`${SERVER} has diverged from ${MAIN} — the deploy branch must never carry its own commits`);
}

// 2. Secrets / session data must never be tracked on the deploy branch.
const tracked = git('ls-tree', '-r', '--name-only', SERVER).split('\n').filter(Boolean);
const leaked = tracked.filter((p) => FORBIDDEN.some((re) => re.test(p)));
if (leaked.length === 0) {
  pass(`no forbidden path tracked on ${SERVER} (${tracked.length} files scanned)`);
} else {
  for (const p of leaked) fail(`forbidden path tracked on ${SERVER}: ${p}`);
}

// 3. Promotion completeness: a cone directory present on main must exist on server.
let missing = 0;
for (const dir of CONE) {
  let onMain = true;
  try {
    git('cat-file', '-e', `${MAIN}:${dir}`);
  } catch {
    onMain = false;
  }
  if (!onMain) continue;

  let onServer = true;
  try {
    git('cat-file', '-e', `${SERVER}:${dir}`);
  } catch {
    onServer = false;
  }
  if (!onServer) {
    fail(`cone directory '${dir}/' exists on ${MAIN} but is missing on ${SERVER}`);
    missing++;
  }
}
if (missing === 0) pass(`all ${CONE.length} cone directories present on ${SERVER}`);

if (process.exitCode) {
  console.error('\nserver-branch guard: FAILED');
} else {
  console.log('\nserver-branch guard: OK');
}
