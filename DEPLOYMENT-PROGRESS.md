# Deployment Progress Tracker
# Format: [STATUS] Section.Step - description
# STATUS values: PENDING, IN_PROGRESS, VERIFIED, BLOCKED_ON_HUMAN, FAILED
# This list is sequential and matches the guide's numbering exactly - do not renumber or skip.

[VERIFIED] P.2 - Create blank project folder (root = D:\Foodhubbie Project; Windows adaptation)
[VERIFIED] P.3 - Fetch Roshani repo (code source)
[VERIFIED] P.4 - Fetch Food-Hubbie repo (reference only, /tmp)
[VERIFIED] P.5 - Add new infrastructure folders (SupremeAdmin, orchestrator, webhook-server, bot-control-api)
[VERIFIED] P.6 - Initialize new git repo (pushed to origin Foodhubbie-project, main)
[VERIFIED] P.7 - Final structure verification
[VERIFIED] P.7a - Contamination scan (doc-only matches in guide/tracker + Roshani's own brand comments; no Food-Hubbie code copied)
[VERIFIED] 1.1 - AWS account creation (account 772603145096 ready)
[PENDING] 1.2 - Confirm credit + budget alert (budgets exist $1/$20; guide's $100 budget not created - human to confirm/align)
[PENDING] 1.3 - Secure root account MFA (human to confirm root MFA enabled)
[VERIFIED] 1.4 - Create IAM user + access key (nilesh-admin, keys configured)
[PENDING] 1.5 - Install AWS CLI + configure
[VERIFIED] 2.1 - Create key pair, security group, launch EC2 (i-0c7f49065b1581542 @ 3.111.39.210, t3.small, sg-0a5a73df4b5d37b38, key foodhubbie-key, AMI ami-07e5ce642bbc48c0d)
[VERIFIED] 3.1 - SSH connect
[VERIFIED] 3.2 - System update
[VERIFIED] 3.3 - Node.js install (v20.20.2)
[VERIFIED] 3.4 - PM2 install (7.0.3)
[VERIFIED] 3.5 - Redis install (PONG, active)
[VERIFIED] 3.6 - Git install (2.43.0)
[VERIFIED] 3.7 - Full section verification (all 6 tools confirmed together)
[PENDING] 4.1 - Cloudflare signup (HUMAN REQUIRED; optional for Quick Tunnel - can defer)
[VERIFIED] 4.2 - Install cloudflared (2026.7.3)
[PENDING] 4.3 - Authenticate cloudflared (HUMAN REQUIRED - browser auth; optional for Quick Tunnel - can defer)
[VERIFIED] 4.4 - Quick Tunnel systemd service (URL photos-whenever-specifics-internationally.trycloudflare.com; logfile adapted to /home/ubuntu/ due to /var/log perms)
[VERIFIED] 4.5 - Auto-update webhook script (deployed + cron every 5min; 3 placeholders to fill after Section 5; cron log at /home/ubuntu/ due to /var/log perms)
[VERIFIED] 5.1 - Meta Developer account (human completed)
[VERIFIED] 5.2 - Create Meta App (app Food-Hubbie WhatsApp)
[VERIFIED] 5.3 - Add WhatsApp product, record IDs (PHONE_NUMBER_ID 1211796118690392, WABA_ID 2589174454849821)
[VERIFIED] 5.4 - Test message send (wamid.HBgMOTE5NzI0NjQ5OTcx... delivered via v25.0)
[VERIFIED] 5.5 - Permanent token (System user 'Foodhubbiebot', never exp, verified on API v19.0 against PHONE_NUMBER_ID 1211796118690392 → +1 555-661-9086); WA_VERIFY_TOKEN=05af5e0291daed08d3ace69e45138af5
[VERIFIED] 5.6 - App Secret recorded (Credentials/Wa app secret.txt: cffcc5cde4cfdef7a189772ca1c8a8ae)
[PENDING] 5.7 - Configure webhook (BLOCKED until Section 8 is done - return here after)
[PENDING] 5.8 - Business Verification submitted (HUMAN REQUIRED, async, does not block later steps)
[PENDING] 6.1 - Project folder created on server
[PENDING] 6.2 - GitHub SSH access
[PENDING] 6.3 - Clone the NEW repo onto server (from Section P.6 - this is when the tracker itself arrives on the server, already containing P.2-P.7a's status)
[PENDING] 6.4 - Verify folder structure landed correctly
[PENDING] 7.1 - Bot dependencies installed
[VERIFIED] 7.2 - Firebase service account placed at bot/service-account.json (project foodhubbie-10, validated). NOTE: project differs from codebase's prashant-pizza-e86e4 — apps must be repointed to foodhubbie-10 web config when web apps are created.
[VERIFIED] 7.3 - .env created (0 placeholders; FIREBASE_DATABASE_URL=foodhubbie-10-default-rtdb, WA tokens + app secret filled)
[VERIFIED] 7.4 - .gitignore updated
[VERIFIED] 17-GATE - Code-side multi-tenant refactor complete + LIVE VERIFIED: gate-verify.js --live PASSES against foodhubbie-10 (found businesses/roshani-cake/outlets/cake + roshani-pizza/outlets/pizza). DB seeded with businesses/{bid}/outlets/{oid} for both restaurants; migrationStatus.multiOutlet = {migrated:true, outlets:[pizza,cake]}. All apps (menu/Admin/rider) repointed to foodhubbie-10 web config. Admin + rider apps built and deployed to hosting:admin + hosting:rider; menu + database deployed. DELIVERY WEBVIEW fixes verified: OUTLET resolution (?o=/?b=), webviewTokens rules, settings/Delivery/slabs public read, webview_delivery order gate, geolocation=(self) policy, sw v8. E2E order placed live. BOT deploy to EC2 remains PENDING (instance unreachable from this machine).
[PENDING] 8.1 - Webhook server files created
[PENDING] 8.2 - Webhook server code written
[PENDING] 8.3 - Webhook server started via PM2
[PENDING] 8.4 - Test health endpoint locally
[PENDING] 8.5 - Test health endpoint through the tunnel
[PENDING] 8.6 - Meta webhook verified (return to 5.7, mark it VERIFIED too once this passes)
[PENDING] 9.1 - whatsapp-send.js helper created
[PENDING] 9.2 - bot/index.js Baileys migration (grep-checklist method, see Section 9.2)
[PENDING] 9.3 - Baileys package removed
[PENDING] 9.4 - End-to-end message test
[PENDING] 10.1 - Orchestrator dependencies
[PENDING] 10.2 - Orchestrator code written
[PENDING] 10.3 - Orchestrator started
[PENDING] 10.4 - Orchestrator end-to-end test
[PENDING] 10.5 - PM2 startup on reboot enabled
[PENDING] 11.1 - SupremeAdmin folder structure (local/CI, not server)
[PENDING] 11.2 - Firebase Hosting target added
[PENDING] 11.3 - Minimal index.html deploy test
[PENDING] 11.4 - Real dashboard pages built (one file at a time, per Section 11.4's instruction)
[PENDING] 11.4a - Restaurant Profile page + Bot Control API deployed
[PENDING] 13 - Full verify-all.sh script passes clean (all 12 automated checks OK)
