#!/usr/bin/env node
/**
 * Guard for the AWS/EC2 credential retirement —
 * FIREBASE_SERVER_MIGRATION/42_AWS_CREDENTIAL_RETIREMENT.md §4.
 *
 * The first AWS account is decommissioned. Its key pair, IAM CSV (access key +
 * console password), CLI profile, SSH host keys and a secret-bearing access
 * guide were deleted on 2026-11-18. This guard fails if any of that material —
 * or the shape it arrived in — comes back into the repository.
 *
 * Checks
 *   1. No tracked file contains an AWS access-key id (`AKIA…`).
 *   2. No tracked path is a credential container (.pem/.ppk/CSV/`Credentials/`).
 *   3. `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` exists, is gitignored and is
 *      NOT tracked (the template the new account is filled into).
 *   4. `ACCESS.md` has no live AWS identifier and points at record 42.
 *   5. `.env`, if present, declares no AWS/S3 variable.
 *   6. No CI workflow references AWS credentials, keys or the old host.
 *   7. `.gitignore` still covers every secret container.
 *   8. No tracked package.json declares an AWS SDK (the host shells out to
 *      `aws s3 sync` in one unscheduled script; it does not link the SDK).
 *
 * Run:  node tests/aws-credential-retirement.check.cjs
 *       npm run test:aws-creds
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

let passCount = 0;
let failCount = 0;

function ok(msg) {
  console.log(`PASS  ${msg}`);
  passCount++;
}
function bad(msg) {
  console.error(`FAIL  ${msg}`);
  failCount++;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

function read(file) {
  return fs.readFileSync(path.join(REPO, file), 'utf8');
}

/** Every tracked path, from the index (so a staged-but-deleted file still counts). */
function trackedPaths() {
  return git(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean);
}

/**
 * Paths whose tracked content matches `re`.
 *
 * Reads the working-tree copy when it exists, otherwise the exact staged blob
 * (`git show :path`) — a `git grep` scans only the working tree, so an index-only
 * entry would pass unseen (caught by this guard's own mutation test).
 * Files over 2 MB and binary blobs are skipped: no credential lives there.
 */
function scanTracked(re) {
  const hits = [];
  for (const f of trackedPaths()) {
    let body;
    try {
      const abs = path.join(REPO, f);
      if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      try {
        body = git(['show', `:${f}`]);
      } catch {
        continue;
      }
    }
    if (body.includes('\0')) continue;
    if (re.test(body)) hits.push(f);
  }
  return hits;
}

// 1. No AWS access-key id anywhere in tracked content.
const keyHits = scanTracked(/AKIA[0-9A-Z]{16}/);
if (keyHits.length === 0) ok('no tracked file contains an AWS access-key id');
else for (const f of keyHits) bad(`AWS access-key id in tracked file: ${f}`);

// 2. No credential container is tracked.
const FORBIDDEN = [
  /\.pem$/i,
  /\.ppk$/i,
  /accessKeys.*\.csv$/i,
  /(credentials|_credentials)\.csv$/i,
  /^Credentials\//,
  /SERVER-ACCESS-GUIDE\.md$/,
  /(^|\/)\.aws\//,
];
const tracked = trackedPaths();
const trackedSecrets = tracked.filter((p) => FORBIDDEN.some((re) => re.test(p)));
if (trackedSecrets.length === 0) {
  ok(`no credential container tracked (${tracked.length} files scanned)`);
} else {
  for (const p of trackedSecrets) bad(`credential container tracked: ${p}`);
}

// 3. The new-account template exists but can never be committed.
const TEMPLATE = 'Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md';
if (!fs.existsSync(path.join(REPO, TEMPLATE))) {
  bad(`${TEMPLATE} is missing — the new account has nowhere to record its details`);
} else if (tracked.includes(TEMPLATE)) {
  bad(`${TEMPLATE} is TRACKED — a filled-in copy would publish every secret`);
} else {
  let ignored = false;
  try {
    git(['check-ignore', '-q', TEMPLATE]);
    ignored = true;
  } catch {
    ignored = false;
  }
  if (ignored) ok(`${TEMPLATE} exists, is untracked and gitignored`);
  else bad(`${TEMPLATE} is not gitignored`);
}

// 4. ACCESS.md is the de-facto entry point: it must not carry a live AWS id.
const ACCESS = 'ACCESS.md';
if (!fs.existsSync(path.join(REPO, ACCESS))) {
  bad(`${ACCESS} is missing`);
} else {
  const text = read(ACCESS);
  const leaks = [
    [/AKIA[0-9A-Z]{16}/, 'AWS access-key id'],
    [/signin\.aws\.amazon\.com/i, 'AWS console sign-in URL'],
    [/\bssh\s+ubuntu@\d{1,3}(\.\d{1,3}){3}/i, 'raw-IP ssh command'],
    [/i-[0-9a-f]{17}\b/, 'EC2 instance id'],
    [/[A-Za-z]:\\[^\n]*\.pem\b/, 'local .pem path'],
  ];
  const found = leaks.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (found.length) bad(`${ACCESS} still carries a live AWS identifier: ${found.join(', ')}`);
  else ok(`${ACCESS} carries no AWS key, console URL, instance id or raw-IP command`);

  if (/42_AWS_CREDENTIAL_RETIREMENT\.md/.test(text)) ok(`${ACCESS} points at the retirement record`);
  else bad(`${ACCESS} does not reference FIREBASE_SERVER_MIGRATION/42_AWS_CREDENTIAL_RETIREMENT.md`);
}

// 5. Runtime env holds Firebase/Meta values only.
if (fs.existsSync(path.join(REPO, '.env'))) {
  const env = read('.env');
  const awsVars = env
    .split(/\r?\n/)
    .filter((l) => /^\s*(AWS_[A-Z0-9_]+|S3_[A-Z0-9_]+)\s*=/.test(l))
    .map((l) => l.split('=')[0].trim());
  if (awsVars.length) bad(`.env declares AWS variable(s): ${awsVars.join(', ')}`);
  else ok('.env declares no AWS/S3 variable');
} else {
  ok('.env absent (nothing to leak)');
}

// 6. CI must never need AWS — deploys are Hosting (Firebase) + explicit server steps.
const workflows = fs.existsSync(path.join(REPO, '.github', 'workflows'))
  ? fs.readdirSync(path.join(REPO, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f))
  : [];
let ciHits = 0;
for (const wf of workflows) {
  const body = read(path.join('.github', 'workflows', wf));
  const hits = [
    [/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/, 'AWS credential env'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access-key id'],
    [/\baws-actions\//, 'AWS GitHub Action'],
    [/\b(3\.111\.39\.210)\b/, 'retired host'],
  ]
    .filter(([re]) => re.test(body))
    .map(([, label]) => label);
  for (const label of hits) {
    bad(`.github/workflows/${wf} references ${label}`);
    ciHits++;
  }
}
if (ciHits === 0) {
  ok(`no CI workflow references AWS credentials (${workflows.length} workflow${workflows.length === 1 ? '' : 's'})`);
}

// 7. The ignore rules that make the deletions stick.
const ignore = read('.gitignore');
for (const rule of ['*.pem', 'Credentials/', 'nilesh-admin_*.csv', 'foodhubbie-key.pem']) {
  if (ignore.split(/\r?\n/).some((l) => l.trim() === rule)) ok(`.gitignore covers ${rule}`);
  else bad(`.gitignore lost the rule: ${rule}`);
}

// 8. No AWS SDK dependency (keeps the "host needs no AWS library" invariant).
const pkgHits = scanTracked(/["'](?:@aws-sdk\/[a-z0-9-]+|aws-sdk)["']\s*:/);
if (pkgHits.length === 0) ok('no tracked package.json declares an AWS SDK');
else for (const f of pkgHits) bad(`AWS SDK dependency declared in ${f}`);

console.log('');
if (failCount) {
  console.error(`aws-credential-retirement guard: FAILED (${passCount} passed, ${failCount} failed)`);
  process.exit(1);
}
console.log(`aws-credential-retirement guard: OK (${passCount} passed)`);
