#!/usr/bin/env node
/**
 * Backup bot session directories to S3
 * Run via cron: 0 3 * * * cd /path/to/bot && node backup-sessions.js
 * Requires AWS credentials in environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION)
 * S3 bucket must exist and be writable by the credentials
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BUCKET = process.env.SESSION_BACKUP_BUCKET || 'foodhubbie-bot-sessions';
const PREFIX = process.env.SESSION_BACKUP_PREFIX || 'session-backups';

function log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${msg}`);
}

function run(cmd, opts = {}) {
    log(`$ ${cmd}`);
    try {
        const out = execSync(cmd, { stdio: 'pipe', ...opts });
        if (out) console.log(out.toString().trim());
        return true;
    } catch (e) {
        console.error(`[ERROR] ${e.message}`);
        if (e.stdout) console.log(e.stdout.toString());
        if (e.stderr) console.error(e.stderr.toString());
        return false;
    }
}

function main() {
    log('=== Session Backup Started ===');

    // Check AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        log('[ERROR] AWS credentials not set. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
        process.exit(1);
    }

    // Find all session_data_* directories
    const dirs = fs.readdirSync(ROOT)
        .filter(d => d.startsWith('session_data_'))
        .filter(d => fs.statSync(path.join(ROOT, d)).isDirectory());

    if (dirs.length === 0) {
        log('[WARN] No session_data_* directories found');
        return;
    }

    log(`Found ${dirs.length} session directories: ${dirs.join(', ')}`);

    let allOk = true;
    for (const dir of dirs) {
        const localPath = path.join(ROOT, dir);
        const s3Path = `s3://${BUCKET}/${PREFIX}/${dir}/`;

        log(`Syncing ${dir} → ${s3Path}`);
        const cmd = `aws s3 sync "${localPath}" "${s3Path}" --delete --storage-class STANDARD_IA`;
        const ok = run(cmd);
        if (!ok) {
            log(`[ERROR] Failed to sync ${dir}`);
            allOk = false;
        } else {
            log(`[OK] ${dir} synced successfully`);
        }
    }

    if (allOk) {
        log('=== All session directories backed up successfully ===');
    } else {
        log('[ERROR] Some backups failed');
        process.exit(1);
    }
}

main().catch(e => {
    console.error('[FATAL]', e);
    process.exit(1);
});