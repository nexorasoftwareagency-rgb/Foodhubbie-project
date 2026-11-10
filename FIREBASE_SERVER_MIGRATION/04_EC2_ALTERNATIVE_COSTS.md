# EC2 Alternative - Detailed Cost Analysis

## Why Consider EC2?

Even though Firebase Functions is recommended, EC2 remains a valid alternative for teams with:
- Existing EC2 expertise and tooling
- Need for full OS control
- Persistent local state requirements
- Cost predictability (fixed monthly)
- Hybrid workloads (Baileys + Meta API)

---

## Workload Requirements (100 Outlets, Meta API Only)

| Requirement | Specification |
|-------------|---------------|
| **Concurrent Webhook Requests** | 200 (peak) |
| **Concurrent Order Processing** | 100 (task workers) |
| **Scheduled Jobs** | 8M/month (wallet, costs, reports, promos) |
| **RTDB Connections** | 100+ (listeners for orders, wallet, promos) |
| **Redis Connections** | 200+ (sessions, caps, queues) |
| **Graph API Outbound** | 500 req/sec peak |
| **Memory for Node.js** | 4-8 GB |
| **CPU for Processing** | 8-16 vCPU |
| **Network** | 50+ GB/month egress |
| **Disk I/O** | Moderate (logs, temp files) |

---

## Instance Sizing Options

### Option 1: Single Large Instance (Vertical Scaling)

| Instance | vCPU | RAM | On-Demand $/hr | Monthly (730h) | Suitability |
|----------|------|-----|----------------|----------------|-------------|
| **c6i.2xlarge** | 8 | 16 GB | $0.374 | **$273.02** | ✅ Recommended |
| c6i.4xlarge | 16 | 32 GB | $0.748 | $546.04 | Overkill |
| c6i.xlarge | 4 | 8 GB | $0.187 | $136.51 | ⚠️ Tight |
| r6i.2xlarge | 8 | 64 GB | $0.504 | $367.92 | Memory heavy |
| m6i.2xlarge | 8 | 32 GB | $0.386 | $281.78 | Balanced |

**Recommendation: c6i.2xlarge** — Compute optimized, good price/performance for Node.js workloads.

### Option 2: Auto Scaling Group (Horizontal Scaling)

| Configuration | Min | Max | Desired | Est. Monthly |
|---------------|-----|-----|---------|--------------|
| **ASG c6i.xlarge** | 2 | 10 | 3 | **$409.53** (3 × $136.51) |
| ASG c6i.large | 3 | 15 | 5 | $341.25 (5 × $68.25) |
| ASG t3.large | 3 | 15 | 5 | $219.00 (5 × $43.80) |

> ASG adds complexity (load balancer, session affinity, health checks) but provides HA.

### Option 3: Container on EC2 (ECS/EKS)

| Option | Control Plane | Worker Nodes | Est. Monthly |
|--------|---------------|--------------|--------------|
| **ECS Fargate** | Free | 4 vCPU/8GB × 3 | **$350-400** |
| EKS Managed | $73 | 3 × c6i.xlarge | **$480** |
| Self-managed k8s | $0 | 3 × c6i.xlarge | **$410** |

> **Not recommended** — adds orchestration overhead for marginal benefit at this scale.

---

## Detailed Cost Breakdown (c6i.2xlarge Single Instance)

### Compute

| Component | Specification | Monthly Cost |
|-----------|---------------|--------------|
| **EC2 c6i.2xlarge** | 8 vCPU, 16 GB, On-Demand | **$273.02** |
| **EBS Root** | 100 GB gp3 | **$8.00** |
| **EBS Logs** | 50 GB gp3 | **$4.00** |
| **EBS Redis Backup** | 20 GB gp3 | **$1.60** |

### Network

| Component | Usage | Monthly Cost |
|-----------|-------|--------------|
| **Data Transfer Out** | 50 GB (Meta API, Firebase, Webhooks) | **$4.50** |
| **Data Transfer In** | Free | $0 |
| **Elastic IP** | 1 (attached) | **$0.00** |
| **VPC Endpoints** | 0 (not needed) | $0 |

### Redis (ElastiCache)

| Component | Specification | Monthly Cost |
|-----------|---------------|--------------|
| **Primary Node** | cache.r6g.large (13 GB, 2 vCPU) | **$112.00** |
| **Replica (HA)** | cache.r6g.large (Multi-AZ) | **$112.00** |
| **Backup Storage** | 10 GB | **$0.30** |
| **Total (HA)** | | **$224.30** |
| **Total (Single-AZ)** | cache.r6g.large | **$112.30** |

> **Recommendation: Single-AZ** — Redis is cache; sessions can rebuild. Save $112/mo.

### Monitoring & Operations

| Component | Specification | Monthly Cost |
|-----------|---------------|--------------|
| **CloudWatch Logs** | 10 GB ingestion + storage | **$5.00** |
| **CloudWatch Metrics** | 50 custom metrics | **$1.50** |
| **CloudWatch Alarms** | 20 alarms | **$2.00** |
| **SSM Session Manager** | Free tier | $0 |
| **Backup (AMI Snapshots)** | Weekly, 10 GB | **$2.00** |

### Security & Compliance

| Component | Monthly Cost |
|-----------|--------------|
| **AWS Config** | $2.00 |
| **GuardDuty** | $4.00 |
| **Security Hub** | Free tier |

---

## Total Monthly Cost Comparison

| Architecture | Compute | Redis | Network | Monitoring | **Total** |
|--------------|---------|-------|---------|------------|-----------|
| **Single c6i.2xlarge (Single-AZ Redis)** | $286.62 | $112.30 | $4.50 | $10.50 | **$413.92** |
| **Single c6i.2xlarge (HA Redis)** | $286.62 | $224.30 | $4.50 | $10.50 | **$525.92** |
| **ASG c6i.xlarge ×3 (Single-AZ Redis)** | $433.53 | $112.30 | $6.00 | $15.00 | **$566.83** |
| **ECS Fargate (3 tasks)** | ~$380 | $112.30 | $6.00 | $15.00 | **$513.30** |

### Reserved Instance Savings (1-Year, No Upfront)

| Instance | On-Demand | 1yr RI | Savings |
|----------|-----------|--------|---------|
| c6i.2xlarge | $273.02 | $191.32 | **30% ($81.70)** |
| cache.r6g.large | $112.00 | $78.40 | **30% ($33.60)** |

**With 1yr RI (Single-AZ): $413.92 - $115.30 = $298.62/mo**

### Reserved Instance Savings (3-Year, No Upfront)

| Instance | On-Demand | 3yr RI | Savings |
|----------|-----------|--------|---------|
| c6i.2xlarge | $273.02 | $136.51 | **50% ($136.51)** |
| cache.r6g.large | $112.00 | $56.00 | **50% ($56.00)** |

**With 3yr RI (Single-AZ): $413.92 - $192.51 = $221.41/mo**

---

## EC2 vs Firebase Functions Cost Comparison

| Metric | EC2 (On-Demand) | EC2 (1yr RI) | EC2 (3yr RI) | Firebase Functions |
|--------|-----------------|--------------|--------------|-------------------|
| **Monthly Compute** | $414 | $299 | $221 | **$40** |
| **Annual Compute** | $4,967 | $3,583 | $2,657 | **$480** |
| **Meta WhatsApp** | ₹111,420 | ₹111,420 | ₹111,420 | ₹111,420 |
| **Total Monthly (₹)** | ~₹146K | ~₹131K | ~₹123K | **~₹116K** |
| **Ops Overhead** | High | High | High | **Zero** |
| **Scaling** | Manual/ASG | Manual/ASG | Manual/ASG | **Auto** |
| **Availability** | Single AZ | Single AZ | Single AZ | **Multi-AZ** |
| **Deployment** | SSH/PM2 | SSH/PM2 | SSH/PM2 | **CI/CD** |
| **Rollback** | Manual | Manual | Manual | **Instant** |

---

## Operational Costs (Hidden)

| Activity | Time/Month | Hourly Rate | Monthly Cost |
|----------|------------|-------------|--------------|
| **OS Patching** | 4 hrs | $100 | $400 |
| **PM2 Management** | 8 hrs | $100 | $800 |
| **Log Rotation/Analysis** | 4 hrs | $100 | $400 |
| **Backup Verification** | 2 hrs | $100 | $200 |
| **Security Scans** | 2 hrs | $100 | $200 |
| **Incident Response** | 8 hrs (avg) | $100 | $800 |
| **Capacity Planning** | 2 hrs | $100 | $200 |
| **Total Operational** | **30 hrs** | | **$3,000** |

> **True EC2 Cost = $299 + $3,000 = $3,299/mo** (with 1yr RI + ops)
> **True Functions Cost = $40 + $0 = $40/mo** (zero ops)

---

## When EC2 Makes Sense

| Scenario | Recommendation |
|----------|----------------|
| **Baileys bots required** | EC2/Cloud Run (persistent WebSocket) |
| **Team has strong DevOps** | EC2 viable |
| **Regulatory: data residency** | EC2 in specific region |
| **Existing reserved capacity** | Use RI |
| **Custom kernel/modules needed** | EC2 only |
| **Predictable, steady load** | EC2/RI cost-effective |
| **< 20 outlets** | EC2 t3.medium sufficient |

---

## Migration to EC2 (If Chosen)

### Architecture on EC2

```
┌─────────────────────────────────────────────────────────────┐
│                     EC2 INSTANCE (c6i.2xlarge)              │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐  │
│  │ PM2 Process  │ │ PM2 Process  │ │ PM2 Process        │  │
│  │ Webhook API  │ │ Task Workers │ │ Scheduled Jobs     │  │
│  │ (Express)    │ │ (BullMQ)     │ │ (node-cron)        │  │
│  └──────────────┘ └──────────────┘ └────────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐                          │
│  │ Redis        │ │ Node.js      │                          │
│  │ (Local/      │ │ Shared Libs  │                          │
│  │  ElastiCache)│ │              │                          │
│  └──────────────┘ └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### PM2 Ecosystem Config

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'webhook-api',
      script: 'dist/api/webhook.js',
      instances: 4,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        FUNCTION_TARGET: 'webhookApi'
      }
    },
    {
      name: 'task-worker',
      script: 'dist/workers/orderProcessor.js',
      instances: 8,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'order'
      }
    },
    {
      name: 'scheduled-jobs',
      script: 'dist/scheduled/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        JOB_TYPES: 'wallet,costs,reports,promos'
      }
    }
  ]
};
```

### Required Infrastructure

| Component | Tool | Effort |
|-----------|------|--------|
| **CI/CD Pipeline** | GitHub Actions → EC2 (SSH/CodeDeploy) | 16 hrs |
| **Secrets Management** | AWS Secrets Manager / SSM Parameter Store | 8 hrs |
| **Log Aggregation** | CloudWatch Agent / Loki | 8 hrs |
| **Monitoring Dashboards** | CloudWatch / Grafana | 16 hrs |
| **Alerting** | CloudWatch Alarms / PagerDuty | 8 hrs |
| **Backup/DR** | AMI + Redis Snapshots | 8 hrs |
| **Security Hardening** | CIS Benchmarks, SSM | 16 hrs |
| **Load Testing** | k6 / Artillery | 8 hrs |
| **Total Setup** | | **88 hrs** |

---

## Summary: EC2 Verdict

| Factor | Score (1-5) | Notes |
|--------|-------------|-------|
| **Cost Efficiency** | 2 | 10× Functions cost with ops |
| **Scalability** | 3 | Manual/ASG, slower |
| **Reliability** | 3 | Single AZ, manual failover |
| **Operational Simplicity** | 1 | High ongoing burden |
| **Team Familiarity** | 4 | If strong DevOps |
| **Feature Parity** | 4 | Can replicate all functions |
| **Time to Production** | 2 | 2-3 weeks setup |

**Overall: 2.5/5** — Only choose EC2 if Baileys required or team lacks serverless experience.

**Recommendation: Firebase Functions 2nd Gen** — Lower TCO, zero ops, better reliability.