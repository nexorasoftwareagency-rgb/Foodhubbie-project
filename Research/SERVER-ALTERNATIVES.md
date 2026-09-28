# Server Alternatives (trusted) — vs current AWS EC2 t3.small $15/mo

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Prices verified:** Sep 2026 (getdeploying, cloudpricecheck, docs.oracle.com, docs.digitalocean.com)

> Research only — no codebase changes. What runs on the box (P3-8 measured): Node bots (110 MB/outlet) + webhook-server, ~2 GB RAM baseline today, needs Linux + Node + SSH; AWS SSM used today for remote commands.

**Trust criteria:** company reputation & age · uptime/SLA · support quality · **India datacenter** (webhook latency to Indian gateways) · predictable billing (no surprise egress) · drop-in compatibility (Node, systemd, SSH).

---

## The alternatives

| # | Provider | Plan (2 vCPU class) | $/mo | India DC? | Trust notes |
|---|---|---|---|---|---|
| 1 | **Oracle Cloud Always Free** (Mumbai) | ARM 2 OCPU + 12 GB RAM + 2× AMD micro | **$0 forever** | ✅ Mumbai | Oracle brand; **but** free-tier rules cut silently Jun 2026 (4/24→2/12), idle-reclaim rule, capacity errors, needs real credit card |
| 2 | **Hetzner** (DE) | CX23 2vCPU/4GB (ARM CAX11 $4.15) | **$7** | ❌ (EU/US/SG) | German, rock-solid, dev-favorite, 20 TB egress incl.; no India — Singapore ~70 ms to India |
| 3 | **Vultr** (Mumbai) | 2vCPU/4GB $20 · 1vCPU/2GB $10 | **$10–20** | ✅ Mumbai | Since 2014, 30+ DCs, 2 TB egress incl., cheapest of the India trio |
| 4 | **DigitalOcean** (Bengaluru) | 1vCPU/2GB $12 · 2vCPU/4GB $24 | **$12–24** | ✅ Bengaluru | Public company (NYSE), best docs/tutorials, flat predictable pricing, $200 credit |
| 5 | **Linode / Akamai** (Mumbai) | 1vCPU/2GB $13 | **$13** | ✅ Mumbai | Akamai-owned (2022) = world-class CDN/network; 22 regions, $5 nanode entry |
| 6 | **Stay AWS, cheapest way** | t3.small 1-yr Reserved/Savings Plan | **~$10** | (same) | Zero migration; 37% off on-demand; keeps SSM tooling |
| 7 | AWS Lightsail (Mumbai) | flat-rate VPS | $5–20 | ✅ Mumbai | AWS trust with flat bill, less admin than full EC2 |

Not recommended for this box: **PaaS** (Render/Railway/Fly) — persistent multi-process bot + SSH workflow fits a plain VPS better; **OVH/Contabo** — cheaper but inconsistent support reputation; **GCP/Azure free tiers** — e2-micro/B1s (1 GB) too small, 12-month limits.

---

## Verdict

| Situation | Pick | Cost |
|---|---|---|
| **Cheapest, accept rug-risk** | Oracle Cloud Always Free, Mumbai home region — 12 GB fits ~60 outlets by our 110 MB/bot math | **$0/mo** |
| **Cheapest *trustworthy* paid, India** | **Vultr Mumbai $10 (2 GB)** / DO Bengaluru $12 | **$10–12/mo** |
| **Best value overall, no India DC needed** | Hetzner CX23 (4 GB, 2 vCPU) | **$7/mo** |
| **Zero migration effort** | keep t3.small + 1-yr commitment | ~$10/mo |

**Recommendation:** for a production ERP with Indian restaurant webhooks → **Vultr Mumbai or DigitalOcean Bengaluru ($10–12/mo)**: established providers, India latency, flat billing, drop-in (same Ubuntu + Node + systemd). Use **Oracle Free Tier** as the free dev/staging box, not as the sole production host (their free-tier terms changed without notice in Jun 2026). If SSM scripts matter, keep AWS at ~$10/mo — SSM has no direct equivalent elsewhere; plain SSH replaces it.

**Impact on cost matrix (§6):** server column drops $15→$10 (AWS RI) or $15→$12 (Vultr/DO) at 10-rest tier; larger tiers: 50-rest t3.large $61 → Vultr/DH 8GB $20–40, 100-rest t3.xlarge $122 → $40–80. Server becomes a rounding error; Firebase dominates.

### Migration notes (if you move)
- SSH key + Ubuntu 24.04 + Node LTS + systemd units = same deployment; `aws ssm send-command` → plain `ssh` (update `tools/p38-ec2-check.json` workflow).
- OCI ARM = arm64 — Node official binaries support it; verify any native npm deps (`node-gyp`) build on arm64.
- Pick region by traffic: Firebase RTDB (us-central1) for bot polling vs India for payment webhooks — async polling makes either acceptable at our scale.
