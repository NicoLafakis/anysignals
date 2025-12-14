# AnySignals Deployment Guide for Claude Desktop + Hostinger MCP

This document provides context for Claude Desktop (with Hostinger MCP connector) to deploy and manage the AnySignals application on a Hostinger VPS.

---

## Project Overview

**AnySignals** is a rate-limited queue service that sits between Clay and the AnySite API. It accepts batches of records and drips them out at **1 request per 10 seconds** (6/min) to bypass MCP rate limits.

### Architecture
```
Clay → AnySignals (VPS:3456) → Redis/BullMQ → Worker → AnySite API
                                                  ↓
                                          Callback Webhook → Clay/Relay
```

---

## VPS Requirements

### Prerequisites (install if not present)
- **Node.js 18+** - Required for the application
- **Redis** - Required for BullMQ job queue
- **PM2** - Process manager for running server + worker
- **Git** - To clone the repository

### Check Commands
```bash
node --version      # Should be 18+
redis-cli ping      # Should return PONG
pm2 --version       # Should be installed
git --version       # Should be installed
```

### Install Prerequisites (Ubuntu/Debian)
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Redis
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# PM2
sudo npm install -g pm2

# Git (usually pre-installed)
sudo apt-get install -y git
```

---

## Deployment Steps

### 1. Clone Repository
```bash
cd /home
git clone https://github.com/NicoLafakis/anysignals.git
cd anysignals
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with the following values:

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3456) | No |
| `REDIS_URL` | Redis connection (default: redis://localhost:6379) | No |
| `ANYSITE_API_KEY` | JWT token from AnySite | **YES** |
| `ANYSITE_BASE_URL` | AnySite API URL (default: https://mcp.anysite.io/mcp) | No |
| `WEBHOOK_SECRET` | Secret for authenticating incoming requests | **YES** |
| `DRIP_INTERVAL_MS` | Ms between jobs (default: 10000 = 10s) | No |
| `MAX_BATCH_SIZE` | Max records per batch (default: 2000) | No |

### 3. Install Dependencies
```bash
npm install
```

### 4. Open Firewall Port
```bash
sudo ufw allow 3456/tcp
sudo ufw status
```

### 5. Start Services
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Run the command it outputs to enable auto-start on reboot
```

---

## Verification

### Health Check
```bash
curl http://localhost:3456/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "redis": "connected",
  "queueDepth": 0,
  "waiting": 0,
  "active": 0
}
```

### Test Single Job
```bash
curl -X POST http://localhost:3456/api/single \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_WEBHOOK_SECRET" \
  -d '{
    "tool": "get_linkedin_profile",
    "params": { "user": "https://linkedin.com/in/satyanadella" },
    "rowId": "test_001"
  }'
```

### View Logs
```bash
pm2 logs                    # All logs
pm2 logs anysignals-worker  # Worker only
pm2 logs anysignals-server  # Server only
```

---

## Management Commands

### Restart Services
```bash
pm2 restart all
```

### Stop Services
```bash
pm2 stop all
```

### Update Application
```bash
cd /home/anysignals
git pull
npm install
pm2 restart all
```

### Check Queue Status
```bash
curl http://localhost:3456/api/stats
```

### Check Redis
```bash
redis-cli LLEN bull:anysignals:jobs:wait   # Pending jobs
redis-cli KEYS "anysignals:result:*"       # Stored results
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (no auth) |
| `/api/batch` | POST | Queue batch of records |
| `/api/single` | POST | Queue single record |
| `/api/status/:batchId` | GET | Check batch progress |
| `/api/stats` | GET | Queue statistics |
| `/api/tools` | GET | List available tools |

All endpoints except `/api/health` require `X-Webhook-Secret` header.

---

## Environment Variables Needed from User

Before deployment, obtain these values:

1. **ANYSITE_API_KEY** - User's AnySite JWT token
2. **WEBHOOK_SECRET** - Generate with: `openssl rand -hex 32`

---

## Troubleshooting

### Redis not running
```bash
sudo systemctl start redis-server
sudo systemctl status redis-server
```

### Port 3456 not accessible externally
```bash
sudo ufw allow 3456/tcp
# Also check Hostinger's VPS firewall in hPanel
```

### PM2 processes not starting on reboot
```bash
pm2 startup
pm2 save
```

### View error logs
```bash
pm2 logs --err
cat /home/anysignals/logs/server-error.log
cat /home/anysignals/logs/worker-error.log
```

---

## File Structure

```
/home/anysignals/
├── package.json           # Dependencies
├── .env                   # Environment config (secrets - not in git)
├── .env.example           # Template for env vars
├── ecosystem.config.js    # PM2 configuration
├── server.js              # Express API server (port 3456)
├── worker.js              # BullMQ job processor
├── lib/
│   ├── queue.js           # Redis/BullMQ setup
│   ├── anysite-client.js  # AnySite API client
│   ├── tool-registry.js   # Tool → endpoint mappings
│   ├── callback.js        # Webhook delivery
│   └── logger.js          # Winston logging
└── logs/                  # PM2 log files
```

---

## Summary for Claude

When user asks to deploy AnySignals:

1. **Check prerequisites** - Node 18+, Redis, PM2, Git
2. **Clone repo** to `/home/anysignals`
3. **Get secrets** from user - ANYSITE_API_KEY and WEBHOOK_SECRET
4. **Create .env** with their values
5. **Install deps** - `npm install`
6. **Open firewall** - port 3456
7. **Start PM2** - `pm2 start ecosystem.config.js && pm2 save`
8. **Verify** - curl health endpoint
