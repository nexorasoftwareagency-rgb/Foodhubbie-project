# 42 — AWS / EC2 CREDENTIAL RETIREMENT

**Date:** 2026-11-18
**Trigger:** the first AWS account is being abandoned; a new Amazon account will host the
rebuilt WhatsApp socket box. Every credential, key file, console id and login belonging to
the old account had to be found, recorded and removed so nothing stale can be used or
mistaken for current.
**Outcome:** 15 secret artifacts deleted (repo + machine), 3 docs rewritten, 2 docs
banner-marked, 1 new credentials template created. **No AWS secret was ever committed to
git.** The live database contains zero references to the old account or host.

Companion documents:
- `PLAN/BACKEND-ARCHITECTURE.md` — why EC2 still exists (socket only) and the 24-gate runbook.
- `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` — the blank template the owner fills (gitignored).
- `tools/verify-box.sh` — automated gates 1–22 for a rebuilt box.

---

## 1. Verdict first

| Question | Answer | Evidence |
|---|---|---|
| Was an AWS secret key ever committed? | **No** | `git grep -lE "AKIA[0-9A-Z]{16}"` → no file, on any branch (`git log --all -p -S "AKIA"` → empty) |
| Is the old access key still usable? | **No** | `aws sts get-caller-identity` → `InvalidClientTokenId` for both the IAM key and the Bedrock key |
| Does the live database still point at the old host? | **No** | full RTDB walk: 80,842 nodes / 1,198,306 chars, 0 hits for the IP, instance id, account id, key name or `amazonaws.com` |
| Does any runtime code require AWS? | **No** | the only AWS consumer is `bot/backup-sessions.js`, which has no caller, no cron and no env vars |
| Does CI require AWS? | **No** | `.github/workflows/*` use only `FIREBASE_SERVICE_ACCOUNT`, `E2E_ADMIN_PASSWORD`, `GITHUB_TOKEN` |

So the retirement is a **hygiene** operation, not an incident response. Nothing was
actively leaking; the material simply outlived the account.

---

## 2. Complete inventory

`sha256` prefixes and sizes are recorded so the owner can recognise a file without any
secret being written down. "Identical" means byte-for-byte across every copy.

### 2.1 The key pair

| # | Artifact | Location | Size / hash | Notes | Action |
|---|---|---|---|---|---|
| 1 | `foodhubbie-key.pem` | repo root | 1,706 B · `014D52A87CCD…` | RSA private key, `-----BEGIN RSA PRIVATE KEY-----`, key pair name `foodhubbie-key` | **deleted** |
| 2 | `foodhubbie-key.pem` | `C:\Users\2nile\.ssh\` | identical | same key, second copy | **deleted** |
| 3 | `Whatsapp-BOt.pem` | `Downloads\Important Files\` | 1,678 B · `D1AE1E780152…` | **different** key pair (earlier attempt, 2026-07-04); referenced nowhere in the repo or docs | **deleted** |

### 2.2 The IAM access key and console login

| # | Artifact | Location | Size / hash | Notes | Action |
|---|---|---|---|---|---|
| 4 | `nilesh-admin_accessKeys.csv` | repo root | 99 B · `D532747F67EC…` | IAM user `nilesh-admin`, access key id `AKIA…N2EG` | **deleted** |
| 5 | `nilesh-admin_accessKeys.csv` | `Credentials\` | identical | duplicate | **deleted** |
| 6 | `nilesh-admin_accessKeys.csv` | `Downloads\Important Files\` | identical | duplicate | **deleted** |
| 7 | `nilesh-admin_credentials.csv` | repo root | 122 B · `202243647FCE…` | console sign-in URL + IAM password **in plaintext** | **deleted** |
| 8 | `nilesh-admin_credentials.csv` | `Credentials\` | identical | duplicate | **deleted** |
| 9 | `nilesh-admin_credentials.csv` | `Downloads\Important Files\` | identical | duplicate | **deleted** |

### 2.3 The AWS CLI profile

| # | Artifact | Location | Notes | Action |
|---|---|---|---|---|
| 10 | `credentials` | `C:\Users\2nile\.aws\` | one `[default]` profile, key id ending `N2EG`, region `ap-south-1`; STS rejects it | **deleted** |
| 11 | `config` | `C:\Users\2nile\.aws\` | `region = ap-south-1` only | **deleted** |
| 12 | `cli\cache\session.db` | `C:\Users\2nile\.aws\cli\` | cached STS session for the dead key | **deleted** |
| — | `C:\Program Files\Amazon\AWSCLIV2\aws.exe` | machine | the CLI tool itself, holds no credentials | kept |

### 2.4 SSH client state

| # | Artifact | Location | Notes | Action |
|---|---|---|---|---|
| 13 | `known_hosts` | `C:\Users\2nile\.ssh\` | three host-key entries for the old Elastic-IP-less address (ed25519 + rsa + ecdsa) | **entries removed**; `github.com` kept |
| 14 | `known_hosts.old` | `C:\Users\2nile\.ssh\` | the old host only | **deleted** |
| — | PuTTY sessions / WinSCP / Windows Credential Manager | machine | none reference AWS (`cmdkey /list` checked) | nothing to do |

### 2.5 Secret-bearing documents

| # | Artifact | Location | Size / hash | Notes | Action |
|---|---|---|---|---|---|
| 15 | `SERVER-ACCESS-GUIDE.md` | `GUIDEs\` | 5,696 B · `A6A34AAC9D91…` | untracked + gitignored; contained an `AKIA…` key id (line 67), the console URL (61) and a password (119) | **deleted** |
| 16 | `ACCESS.md` | repo root (tracked) | — | the de-facto access reference; carried account id, console URL, instance id, IP, security-group id, key path and live `ssh`/`scp` commands | **rewritten** — §3 is now a retirement notice; all deploy commands point at `tools/server-deploy.sh` |
| 17 | `DEPLOYMENT-PROGRESS.md` | `docs\` (tracked) | — | historical checklist with the account id and instance details | **banner added** |
| 18 | `PLAN-SERVER-BRANCH.md` | `docs\` (tracked) | — | live-looking `ssh ubuntu@<old-ip>` command | **banner added** |
| 19 | `PLAN-PRODUCTION-LAUNCH.md` | `docs\` (tracked) | — | instructed pointing DNS at the old IP and listed the key/CSV as open risks | **banner added** |
| 20 | `WHATSAPP-COEXISTENCE-PLATFORM-DECISION.md` | `Credentials\` (ignored) | — | two-line `scp`/`ssh` snippet with the old IP | **host placeholder** |
| 21 | `docs/PRODUCTION-STATUS-AND-PLAN.md`, `docs/production-grade-checklist.md` | tracked | — | the IP in a status table row and a "requires a TLS proxy on EC2 (IP)" risk note | **scrubbed** — both now point at this record; no raw host left |
| 22 | `Pending-Work.md` | tracked | — | IP + security-group id inside a "Done" entry | left as history (see §5) |

### 2.6 What was checked and deliberately kept

| Artifact | Why it stays |
|---|---|
| `Credentials/foodhubbie-10-firebase-adminsdk-*.json` (+ copies at repo root and in Downloads) | live Firebase Admin SDK key — used by `tools/`, functions tests and the media migration. Not AWS. |
| `Credentials/Meta-*.txt`, `Wa app secret.txt`, `System user Permanent token.txt`, `WA_PERMANENT_TOKEN_NEW.txt` | live Meta / WhatsApp credentials. Not AWS. |
| `Credentials/e2e-admin-password.txt` | E2E tenant login. Not AWS. |
| `.env`, `.env.example` | Firebase/Meta runtime config; **contains no `AWS_*` variable** (verified). |
| `bot/backup-sessions.js` | the only AWS consumer in the tree: `aws s3 sync` to `foodhubbie-bot-sessions`. No caller, no cron, no env vars, and `07_CODE_MAPPING.md` already marks it for deletion. It cannot run without keys and needs no bucket. **Do not schedule it.** |
| `ecosystem.config.js`, `bot-control-api/*`, `webhook-server/*` | no AWS SDK import; the `aws` strings in their `package-lock.json` are base64 integrity hashes, not credentials. |

`.gitignore` was audited rather than changed — it **already** covers every secret that was
found: `*.pem` (line 112), `foodhubbie-key.pem` (113), `Credentials/` (116),
`GUIDEs/SERVER-ACCESS-GUIDE.md` (119), `foodhubbie-10-firebase-adminsdk-*.json` (123),
`nilesh-admin_*.csv` (125), `AWS/` (109). Every one of the 15 deleted files was untracked
and ignored.

---

## 3. Deletion log (2026-11-18)

Deleted from disk:

```
D:\Foodhubbie Project\foodhubbie-key.pem
D:\Foodhubbie Project\nilesh-admin_accessKeys.csv
D:\Foodhubbie Project\nilesh-admin_credentials.csv
D:\Foodhubbie Project\Credentials\nilesh-admin_accessKeys.csv
D:\Foodhubbie Project\Credentials\nilesh-admin_credentials.csv
D:\Foodhubbie Project\GUIDEs\SERVER-ACCESS-GUIDE.md
C:\Users\2nile\.ssh\foodhubbie-key.pem
C:\Users\2nile\.ssh\known_hosts.old
C:\Users\2nile\.aws\credentials
C:\Users\2nile\.aws\config
C:\Users\2nile\.aws\cli\cache\session.db
C:\Users\2nile\Downloads\Important Files\nilesh-admin_accessKeys.csv
C:\Users\2nile\Downloads\Important Files\nilesh-admin_credentials.csv
C:\Users\2nile\Downloads\Important Files\Whatsapp-BOt.pem
C:\Users\2nile\Downloads\Important Files\BedrockAPIKey-g1d7_accessKeys.csv
```

Rewritten in place: `known_hosts` (old-host lines removed, `github.com` retained),
`ACCESS.md` §3, `Credentials/WHATSAPP-COEXISTENCE-PLATFORM-DECISION.md` (host placeholder).

No backup of the deleted secrets was kept — that is the point of the exercise. Sizes and
hash prefixes in §2 are the only record, and they cannot reconstruct a key.

> The Bedrock key (`AKIA…XU`) was a separate AWS service artifact, not EC2. It was tested
> with STS and is also rejected (`InvalidClientTokenId`), so it was deleted with the rest.
> If it turns out to have belonged to a *different* live AWS account, nothing is lost: the
> file only held a dead key.

---

## 4. Post-cleanup verification

Run these at any time to prove the state:

```bash
# 1. no AWS key material tracked, on any branch
git grep -lE "AKIA[0-9A-Z]{16}" -- .          # must print nothing

# 2. no secret path tracked
git ls-files | grep -Ei "\.pem$|nilesh-admin|SERVER-ACCESS-GUIDE|Credentials/"   # must print nothing

# 3. no local copies left
ls D:/Foodhubbie\ Project/*.pem D:/Foodhubbie\ Project/*.csv 2>/dev/null        # must print nothing
ls ~/.aws 2>/dev/null                                                          # must print nothing

# 4. the CLI has no identity at all
aws sts get-caller-identity                                                    # must fail

# 5. the database has no reference to the old host
node %TEMP%/opencode/scan-aws-refs.cjs                                         # hits: []
```

Result on 2026-11-18: 1–5 all clean.

### The automated guard

`node tests/aws-credential-retirement.check.cjs` (`npm run test:aws-creds`, also a CI
step) runs the same idea in 12 assertions and costs ~6 s:

| # | Check |
|---|---|
| 1 | No tracked file contains `AKIA…` (scans disk **and** the staged blob, so an index-only plant cannot hide) |
| 2 | No tracked path is `.pem` / `.ppk` / `*accessKeys*.csv` / `*_credentials.csv` / `Credentials/` / `SERVER-ACCESS-GUIDE.md` / `.aws/` |
| 3 | `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` exists, is untracked and gitignored |
| 4 | `ACCESS.md` carries no key id, console URL, instance id, local `.pem` path or `ssh ubuntu@<ip>` — and still points at this record |
| 5 | `.env` declares no `AWS_*` / `S3_*` variable |
| 6 | No CI workflow references an AWS credential, `aws-actions/*` or the retired host |
| 7 | `.gitignore` still covers `*.pem`, `foodhubbie-key.pem`, `nilesh-admin_*.csv`, `Credentials/` |
| 8 | No tracked `package.json` declares `aws-sdk` / `@aws-sdk/*` |

Mutation-tested: planting an `AKIA` blob and a `.pem` path in the index each fail the
run (11/1) and removing them restores 12/12. **A guard that cannot fail is decoration** —
re-run that mutation if this file is ever edited.

---

## 5. Where the old identifiers still appear (and why that is safe)

The account id, instance id and old address remain in **historical records** — incident
write-ups, the ledger and the vendored Claude packages. They were deliberately not
rewritten:

| Location | Content | Why it stays |
|---|---|---|
| `AGENTS.md` | instance id + IP inside the 2026-11-10 and 2026-11-12 incident records | project memory; changing it would falsify the history that explains the Functions migration |
| `PROJECT_LEDGER.md` | IP in ledger entries | same |
| `FIREBASE_SERVER_MIGRATION/11, 12, 23` | IP / instance id in measurements and the outage record | the evidence behind the architecture decision |
| `PLAN/BACKEND-ARCHITECTURE.md` | instance id in the "last known good" inventory | design record; the runbook intentionally says "a new instance" |
| `Pending-Work.md` | IP in prose | a status snapshot |
| `PLAN/FoodHubbie-Customer app-by Claude V2/**`, `PLAN/FoodHubbie-Customer APP by CLaude/FoodHubbie-Final/**` | full copies of `ACCESS.md` + `DEPLOYMENT-PROGRESS.md` | vendored source snapshots the owner chose to keep (2026-11-05); they are archives, not operating docs |

**None of these contain a key, a password or a usable credential.** An account id, an
instance id and a released IP address cannot authenticate anything: the key is deleted,
the instance is gone, and the address is no longer attached to the account. What they can
do is confuse a future reader, which is why every *actionable* doc now carries a banner or
a retirement section and points at this file.

---

## 6. The new credentials file

`Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` — gitignored, never committed, blank.

It is organised so that filling it top-to-bottom **is** the provisioning order:

| Section | Filled when |
|---|---|
| §1 AWS account | account created (id, root email, console URL, MFA, billing alert) |
| §2 IAM | IAM user + access key created |
| §3 EC2 | instance + Elastic IP + security group exist |
| §4 DNS/TLS | A record points at the Elastic IP and Caddy answers |
| §5 runtime secrets | `.env` written on the box (Firebase/Meta values, not AWS) |
| §6 sign-off | `verify-box.sh` and the manual gates pass |

The **Elastic IP field is mandatory**, not optional. `api.foodhubbie.in` is a plain
GoDaddy A record; an ephemeral address means a stop/start silently breaks DNS,
`platformHealth` and seven CSP `connect-src` entries.

---

## 7. Owner actions that cannot be done from here

| # | Action | Why |
|---|---|---|
| 1 | Close the old AWS account (or at least confirm the instance is terminated) | stop any residual billing; the console may still be reachable with the root login even though the IAM key is dead |
| 2 | Rotate the `roshanipizza@gmail.com` password | carried forward from 2026-11-07: a live production password sat in an untracked test file |
| 3 | Treat the retired IAM password as compromised | it was stored in plaintext in three places and is deleted now; if the same string is used on any other service, change it there |
| 4 | Delete any saved `signin.aws.amazon.com` credential in Chrome's password manager | browser storage cannot be audited safely from here |
| 5 | Decide whether to uninstall the AWS CLI | it is harmless without credentials; keep it if the new account will be driven from this PC |

---

## 8. Re-provisioning plan — old account out, new account in

Each step is small on purpose. Gate numbers refer to `PLAN/BACKEND-ARCHITECTURE.md` §5;
`tools/verify-box.sh` automates gates 1–22.

### Phase A — account (≈15 min)

1. Create the new AWS account. Use a mailbox the owner controls; enable MFA on root.
2. Set a billing alarm (the whole platform's Firebase bill is ~₹470/month; an EC2
   `t3.small` + 20 GB gp3 + Elastic IP is roughly $18–20/month).
3. Create IAM user `foodhubbie-deploy`, attach `AdministratorAccess` **for provisioning
   only**, enable MFA, create one CLI access key.
4. On this PC: `aws configure` with that key, region `ap-south-1`.
   `aws sts get-caller-identity` must print the **new** account id → record in
   `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` §2.
5. Create the key pair and save it outside the repo:
   `aws ec2 create-key-pair --key-name foodhubbie-key --query KeyMaterial --output text > ~/.ssh/foodhubbie-key.pem`
   then `chmod 400` (or `icacls` on Windows).

### Phase B — network (≈10 min)

6. Security group `foodhubbie-socket`: inbound **22 from your current IP only**, **80**
   and **443 from `0.0.0.0/0`**. Nothing else. Ports 3000–3100 stay closed (each bot
   binds `0.0.0.0:$HEALTH_PORT` there).
7. Launch `t3.small`, Ubuntu Server 24.04 LTS x86_64, `ap-south-1`, 20 GB gp3, that
   security group, that key pair.
8. **Allocate an Elastic IP and associate it before anything else.** Record it.
9. GoDaddy: `api.foodhubbie.in` A → the Elastic IP, TTL 600.
   `dig +short api.foodhubbie.in` must print the Elastic IP (gate 3).

### Phase C — host (≈45 min)

10. SSH in as `ubuntu@api.foodhubbie.in`.
11. Install: `git`, Node **≥ 22.12** (NodeSource 22.x — `require(esm)` needs it), `pm2`,
    Caddy, `fail2ban`, `ufw` (22/80/443 only).
12. Clone the repo to `/var/www/foodhubbie`, check out **`server`** (never `main` on the
    box). `git branch --set-upstream-to=origin/server`.
13. Copy `bot/service-account.json` (Firebase Admin SDK) onto the box. It is gitignored
    and never comes from git.
14. Write `/var/www/foodhubbie/.env` from the template in
    `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` §5. `BUSINESS_ID` is **required** —
    without it a test tenant whose outlet is literally named `pizza` can hijack the live
    bot. `GOOGLE_APPLICATION_CREDENTIALS` is required because `bot-control-api` uses
    `applicationDefault()`.
15. `npm ci` at the root, in `bot/`, and in `bot-control-api/` (the control API loads
    `dotenv` itself; a dependency change needs `npm ci --prefix bot-control-api`).
16. Caddy: `api.foodhubbie.in { reverse_proxy 127.0.0.1:4000 }`. Caddy issues the
    certificate. Gate 4: `https://api.foodhubbie.in/api/bot/status-all` returns **401**
    (proves TLS + the auth gate).
17. `pm2 start ecosystem.config.js`, then `pm2 save` and `pm2 startup`. Workers:
    `bot-control-api`, `webhook-server`, one `bot-<bid>-<oid>` per live outlet.
18. `pm2 set` / env check: every worker logs `[TENANT] outlet=<oid> business=<bid>` and
    `transport=baileys`.

### Phase D — WhatsApp (≈15 min per outlet)

19. Open Supreme → the outlet → Connect WhatsApp → scan the QR from the restaurant phone.
    `bot/pair/status` becomes `connected`; `botStatus` heartbeat goes fresh within 2 min.
20. Send one real inbound message and confirm a reply. **This is gate 16 and it is the
    only proof the socket works** — `pair/status` freezes at `connected` after a hard
    power-off, so the status flag alone is not evidence.

### Phase E — verify (≈30 min)

21. On the box: `bash tools/verify-box.sh` → gates 1–22 PASS (23/24 are manual).
22. Manual gates: a real WhatsApp round-trip (16), a real APP order finalized by
    Functions (19), a loyalty credit (20), `bash tools/server-deploy.sh` with no changes
    (23), and one reboot (24) confirming pm2 + the Elastic IP survive.
23. Fill §6 of the credentials file and tick every row.
24. Deploy day-to-day is now **only** `bash tools/server-deploy.sh` on the box. Never
    `scp` individual files — hand edits make the next deploy abort by design
    (`docs/PLAN-SERVER-BRANCH.md`).

### What must NOT be rebuilt

| Skip | Reason |
|---|---|
| The 4 legacy EC2 timers (`startMetaCostPublisher`, `runDailySettlement`, `runUnverifiedCleanup`, `startAutoApproval`) | superseded by Cloud Functions; running both races them |
| `webhook-server` Meta webhook traffic | inbound now arrives through the Functions webhook path; the local receiver is a proxy only |
| `bot-control-api/meta-cost-publisher.js` | cloud `metaCostPublisher` is the single `balancePaise` writer |
| S3 session backups (`bot/backup-sessions.js`) | no caller, no bucket required; Baileys re-pairs by QR |
| Any DB effect | orders, loyalty, stock, payments, push, media, onboarding, settlement, demo reseed and the wallet gate all run in Functions and kept working for six days with the box dead |

---

## 9. Verification performed for this record

| Check | Result |
|---|---|
| `aws sts get-caller-identity` with the retired IAM key | `InvalidClientTokenId` |
| `aws sts get-caller-identity` with the retired Bedrock key | `InvalidClientTokenId` |
| git history, all branches, `-S "AKIA"` | no commit |
| `git grep -lE "AKIA[0-9A-Z]{16}"` | no file |
| tracked `.pem` / CSV / `Credentials/` | none |
| RTDB full walk (80,842 nodes, 1,198,306 chars) | 0 hits for IP, instance id, account id, key name, `amazonaws.com` |
| `.github/workflows` AWS secrets | none |
| local secret files after deletion | 0 |

**Recorded and closed.**
