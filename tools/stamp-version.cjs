#!/usr/bin/env node
// Stamps the public /version.json for a hosting target at deploy time.
//
// shared/app-update.js polls this file on every site and shows the "Update app"
// popup when it differs from the version the browser last acknowledged. It is a
// firebase.json "predeploy" hook, so every deploy of a target bumps exactly that
// site — no manual version strings to remember.
//
//   node tools/stamp-version.cjs            # every built target
//   node tools/stamp-version.cjs admin      # one target (used by predeploy)
//
// The file is generated, never committed (.gitignore).

const { writeFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const ROOT = join(__dirname, '..');

// site key -> { dir, label }. The label is what the popup calls the site.
const TARGETS = {
    admin: { dir: 'Admin/dist', label: 'FoodHubbie Admin' },
    supreme: { dir: 'SupremeAdmin/dist', label: 'FoodHubbie Supreme' },
    menu: { dir: 'menu', label: 'FoodHubbie Menu' },
    website: { dir: 'website', label: 'FoodHubbie' },
    rider: { dir: 'rider-app/dist', label: 'FoodHubbie Rider' },
};

function gitSha() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim() || 'nogit';
    } catch (e) {
        return 'nogit'; // deployed from a source export, not a clone
    }
}

const now = new Date();
const builtAt = now.toISOString();
const stamp = builtAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20261107T123456Z
const version = `${gitSha()}.${stamp}`;

const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = names.length ? names : Object.keys(TARGETS);

let wrote = 0;
for (const name of targets) {
    const target = TARGETS[name];
    if (!target) {
        console.error(`[version] unknown target "${name}" — expected one of ${Object.keys(TARGETS).join(', ')}`);
        process.exitCode = 1;
        continue;
    }
    const dir = join(ROOT, target.dir);
    if (!existsSync(dir)) {
        console.warn(`[version] ${name}: ${target.dir} does not exist yet (build it first) — skipped`);
        continue;
    }
    writeFileSync(
        join(dir, 'version.json'),
        JSON.stringify({ site: name, label: target.label, version, builtAt }, null, 2) + '\n'
    );
    console.log(`[version] ${name}: ${target.dir}/version.json → ${version}`);
    wrote++;
}

if (!wrote) console.warn('[version] nothing stamped');
