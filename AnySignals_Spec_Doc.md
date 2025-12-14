# AnySignals - Rate-Limited Queue Service for AnySite API

## Project Overview

Build a VPS-hosted queue service called **AnySignals** that accepts batches of records from Clay (could be 50 rows, could be 2,000 rows), queues them, and drips them out at **1 record per 10 seconds** (6/min) to the AnySite REST API, bypassing MCP rate limits.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CLAY                                      │
│                    (50 - 2,000 rows)                                │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ HTTP POST /api/batch
                      │ Body: { tool, records[], callbackUrl? }
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AnySignals (VPS)                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Express Server (port 3456)                                  │   │
│  │  - POST /api/batch     → Queue entire batch                  │   │
│  │  - POST /api/single    → Queue single record                 │   │
│  │  - GET  /api/status/:batchId → Check batch progress          │   │
│  │  - GET  /api/health    → Health check                        │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                       │
│                             ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Redis + BullMQ                                              │   │
│  │  - Queue: "anysignals:jobs"                                  │   │
│  │  - Rate Limiter: 1 job per 10 seconds                        │   │
│  │  - Retries: 3 attempts with exponential backoff              │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                       │
│                             ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Worker Process                                              │   │
│  │  - Picks up 1 job every 10 seconds                           │   │
│  │  - Routes to correct AnySite endpoint based on `tool`        │   │
│  │  - Stores result in Redis (TTL: 24 hours)                    │   │
│  │  - Fires callback webhook if provided                        │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                       │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ HTTPS (rate-limited)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AnySite REST API                               │
│                   https://api.anysite.io                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (optional callback)
┌─────────────────────────────────────────────────────────────────────┐
│              Clay Webhook / Relay Workflow                          │
│              (receives results as they complete)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
/home/ubuntu/anysignals/          # (or wherever Node projects live on this VPS)
├── package.json
├── .env                          # API keys - DO NOT COMMIT
├── .env.example                  # Template for env vars
├── ecosystem.config.js           # PM2 config for server + worker
├── server.js                     # Express webhook receiver
├── worker.js                     # BullMQ worker (rate-limited processor)
├── lib/
│   ├── queue.js                  # Queue setup and helpers
│   ├── anysite-client.js         # AnySite REST API client
│   ├── tool-registry.js          # Maps tool names → endpoints
│   └── callback.js               # Webhook callback handler
└── logs/                         # PM2 log output
```

---

## Environment Variables (.env)

```env
# Server
PORT=3456
NODE_ENV=production

# Redis (use existing Redis on this VPS if available)
REDIS_URL=redis://localhost:6379

# AnySite API
ANYSITE_API_KEY=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwYWZlZjZkLTE0ZWQtNDZhMC05NWQ1LWFkODMyMDBjNzk4MiJ9.G3Qawo-wLWywTFth29p90TIynKCzjMRnbT2kzX9QlBK-TNi2AbVaSVtRPmpUWoN-RbzIPTboiJ7yc0z2BlMpoQn_FcY1dvNdZ5PHTZv4hUJdxPqmGbT0dq-Cp4Q5IkfwemfU-gQk4h1vyHmhAr_n-Aeuu84kiKrLi0bSE8ZYqpnWpamnu35GZmncWab_6R8zgDwcZOA-JJfzXkK4H-IWcQPsq9nY9BCYyUVsxJUpiIdkfMNJXHePlqGFHqJcu2IBxR0AP2nV0H90vWjPQfMu9D2F5t7UnItQIn6Gq8wl7_3x_yhfyn8zuxNjkPpKH87j1ikiooJtGTrL-zHjyzZERQ
ANYSITE_BASE_URL=https://mcp.anysite.io/mcp

# Security
WEBHOOK_SECRET=eSnv9UsbXdtn4cL7MzPPgjfNv0tD1oRAmpWJnrH6Qd

# Rate Limiting (milliseconds between jobs)
DRIP_INTERVAL_MS=10000

# Results Storage
RESULT_TTL_SECONDS=86400
```

---

## API Endpoints

### POST /api/batch

Accepts a batch of records to queue.

**Request:**
```json
{
  "tool": "get_linkedin_profile",
  "records": [
    { "user": "https://linkedin.com/in/person1", "rowId": "clay_row_1" },
    { "user": "https://linkedin.com/in/person2", "rowId": "clay_row_2" },
    { "user": "https://linkedin.com/in/person3", "rowId": "clay_row_3" }
  ],
  "callbackUrl": "https://hooks.relay.app/abc123",
  "priority": 1
}
```

**Response:**
```json
{
  "success": true,
  "batchId": "batch_a1b2c3d4",
  "jobsQueued": 3,
  "estimatedCompletionSeconds": 30,
  "statusUrl": "/api/status/batch_a1b2c3d4"
}
```

**Notes:**
- `tool` = which AnySite tool to use (see Tool Registry below)
- `records` = array of parameter objects, each should include a `rowId` for Clay to match results back
- `callbackUrl` = optional webhook to POST results as each job completes
- `priority` = optional (1=high, 10=low, default=5)

---

### POST /api/single

Queue a single record (for testing or real-time use).

**Request:**
```json
{
  "tool": "get_linkedin_company",
  "params": {
    "company": "https://linkedin.com/company/anthropic"
  },
  "callbackUrl": "https://hooks.relay.app/xyz789",
  "rowId": "clay_row_99"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "job_x1y2z3",
  "position": 47,
  "estimatedWaitSeconds": 470
}
```

---

### GET /api/status/:batchId

Check progress of a batch.

**Response:**
```json
{
  "batchId": "batch_a1b2c3d4",
  "total": 100,
  "completed": 45,
  "failed": 2,
  "pending": 53,
  "percentComplete": 45,
  "estimatedRemainingSeconds": 530,
  "results": [
    { "jobId": "job_1", "rowId": "clay_row_1", "status": "completed", "data": { ... } },
    { "jobId": "job_2", "rowId": "clay_row_2", "status": "failed", "error": "Profile not found" }
  ]
}
```

---

### GET /api/health

Health check for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "redis": "connected",
  "queueDepth": 147,
  "workerActive": true,
  "uptime": 86400
}
```

---

## Tool Registry

Map these tool names to AnySite REST endpoints. The worker uses this to route requests.

```javascript
const TOOL_REGISTRY = {
  // ═══════════════════════════════════════════════════════════════════
  // LINKEDIN - PROFILES & USERS
  // ═══════════════════════════════════════════════════════════════════
  'get_linkedin_profile': {
    endpoint: '/api/linkedin/profile',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['with_experience', 'with_education', 'with_skills', 'timeout']
  },
  'search_linkedin_users': {
    endpoint: '/api/linkedin/users/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'first_name', 'last_name', 'title', 'company', 'location', 'industry', 'timeout']
  },
  'get_linkedin_user_posts': {
    endpoint: '/api/linkedin/user/posts',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['count', 'timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // LINKEDIN - COMPANIES
  // ═══════════════════════════════════════════════════════════════════
  'get_linkedin_company': {
    endpoint: '/api/linkedin/company',
    method: 'POST',
    requiredParams: ['company'],
    optionalParams: ['timeout']
  },
  'get_linkedin_company_posts': {
    endpoint: '/api/linkedin/company/posts',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['count', 'timeout']
  },
  'search_linkedin_companies': {
    endpoint: '/api/linkedin/companies/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'location', 'industry', 'company_size', 'timeout']
  },
  'get_linkedin_company_employees': {
    endpoint: '/api/linkedin/company/employees',
    method: 'POST',
    requiredParams: ['company', 'count'],
    optionalParams: ['keywords', 'title', 'timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // LINKEDIN - POSTS & ENGAGEMENT
  // ═══════════════════════════════════════════════════════════════════
  'search_linkedin_posts': {
    endpoint: '/api/linkedin/posts/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'sort', 'date_posted', 'authors', 'author_industries', 'author_title', 'content_type', 'mentioned', 'timeout']
  },
  'get_linkedin_post': {
    endpoint: '/api/linkedin/post',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['include_all_document_images', 'timeout']
  },
  'get_linkedin_post_comments': {
    endpoint: '/api/linkedin/post/comments',
    method: 'POST',
    requiredParams: ['urn', 'count'],
    optionalParams: ['sort', 'timeout']
  },
  'get_linkedin_post_reactions': {
    endpoint: '/api/linkedin/post/reactions',
    method: 'POST',
    requiredParams: ['urn', 'count'],
    optionalParams: ['timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // LINKEDIN - GROUPS
  // ═══════════════════════════════════════════════════════════════════
  'get_linkedin_group': {
    endpoint: '/api/linkedin/group',
    method: 'POST',
    requiredParams: ['group'],
    optionalParams: ['timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // INSTAGRAM
  // ═══════════════════════════════════════════════════════════════════
  'get_instagram_user': {
    endpoint: '/api/instagram/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout']
  },
  'get_instagram_user_posts': {
    endpoint: '/api/instagram/user/posts',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },
  'get_instagram_post': {
    endpoint: '/api/instagram/post',
    method: 'POST',
    requiredParams: ['post'],
    optionalParams: ['timeout']
  },
  'get_instagram_post_comments': {
    endpoint: '/api/instagram/post/comments',
    method: 'POST',
    requiredParams: ['post', 'count'],
    optionalParams: ['timeout']
  },
  'get_instagram_post_likes': {
    endpoint: '/api/instagram/post/likes',
    method: 'POST',
    requiredParams: ['post', 'count'],
    optionalParams: ['timeout']
  },
  'search_instagram_posts': {
    endpoint: '/api/instagram/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['timeout']
  },
  'get_instagram_user_followers': {
    endpoint: '/api/instagram/user/followers',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },
  'get_instagram_user_following': {
    endpoint: '/api/instagram/user/following',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // TWITTER / X
  // ═══════════════════════════════════════════════════════════════════
  'get_twitter_user': {
    endpoint: '/api/twitter/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout']
  },
  'get_twitter_user_tweets': {
    endpoint: '/api/twitter/user/tweets',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },
  'search_twitter_posts': {
    endpoint: '/api/twitter/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['timeout']
  },
  'get_twitter_post': {
    endpoint: '/api/twitter/post',
    method: 'POST',
    requiredParams: ['post'],
    optionalParams: ['timeout']
  },
  'get_twitter_user_followers': {
    endpoint: '/api/twitter/user/followers',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },
  'get_twitter_user_following': {
    endpoint: '/api/twitter/user/following',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // REDDIT
  // ═══════════════════════════════════════════════════════════════════
  'search_reddit_posts': {
    endpoint: '/api/reddit/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['subreddit', 'sort', 'time_filter', 'timeout']
  },
  'get_reddit_post': {
    endpoint: '/api/reddit/post',
    method: 'POST',
    requiredParams: ['post_url'],
    optionalParams: ['timeout']
  },
  'get_reddit_post_comments': {
    endpoint: '/api/reddit/post/comments',
    method: 'POST',
    requiredParams: ['post_url'],
    optionalParams: ['count', 'sort', 'timeout']
  },
  'get_reddit_user': {
    endpoint: '/api/reddit/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout']
  },
  'get_reddit_subreddit': {
    endpoint: '/api/reddit/subreddit',
    method: 'POST',
    requiredParams: ['subreddit'],
    optionalParams: ['timeout']
  },

  // ═══════════════════════════════════════════════════════════════════
  // SEC EDGAR (Financial Filings)
  // ═══════════════════════════════════════════════════════════════════
  'search_sec_companies': {
    endpoint: '/sec/search/companies',
    method: 'POST',
    requiredParams: [],
    optionalParams: ['forms', 'entityName', 'locationCodes', 'dateRange', 'count', 'timeout']
  },
  'get_sec_document': {
    endpoint: '/sec/document',
    method: 'POST',
    requiredParams: ['url'],
    optionalParams: ['timeout']
  }
};
```

---

## Worker Logic (Pseudocode)

```javascript
// worker.js

const worker = new Worker('anysignals:jobs', async (job) => {
  const { tool, params, rowId, callbackUrl, batchId } = job.data;
  
  // 1. Get endpoint config from registry
  const config = TOOL_REGISTRY[tool];
  if (!config) throw new Error(`Unknown tool: ${tool}`);
  
  // 2. Validate required params
  for (const param of config.requiredParams) {
    if (!params[param]) throw new Error(`Missing required param: ${param}`);
  }
  
  // 3. Call AnySite API
  const response = await anysiteClient.request({
    method: config.method,
    endpoint: config.endpoint,
    data: params
  });
  
  // 4. Store result in Redis
  await redis.setex(
    `anysignals:result:${job.id}`,
    RESULT_TTL_SECONDS,
    JSON.stringify({ rowId, tool, data: response, completedAt: new Date() })
  );
  
  // 5. Update batch progress
  if (batchId) {
    await redis.hincrby(`anysignals:batch:${batchId}`, 'completed', 1);
  }
  
  // 6. Fire callback if provided
  if (callbackUrl) {
    await axios.post(callbackUrl, {
      jobId: job.id,
      rowId,
      batchId,
      tool,
      status: 'completed',
      data: response
    });
  }
  
  return response;
  
}, {
  connection: redis,
  // ════════════════════════════════════════════════════════
  // RATE LIMITER: 1 job per 10 seconds (6 per minute)
  // ════════════════════════════════════════════════════════
  limiter: {
    max: 1,
    duration: 10000  // 10 seconds
  },
  concurrency: 1
});
```

---

## PM2 Configuration

```javascript
// ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'anysignals-server',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      merge_logs: true
    },
    {
      name: 'anysignals-worker',
      script: 'worker.js',
      instances: 1,  // MUST be 1 for rate limiting to work correctly
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true
    }
  ]
};
```

---

## Setup Instructions for Claude Code

### Step 1: Check Existing Infrastructure

```bash
# Check Node version (need 18+)
node --version

# Check if Redis is running
redis-cli ping

# Check PM2
pm2 list

# Find where other Node projects live
ls -la /home/ubuntu/  # or /root/ or /var/www/
```

### Step 2: Create Project Directory

```bash
# Use same location as other Node projects on this VPS
mkdir -p /home/ubuntu/anysignals
cd /home/ubuntu/anysignals
mkdir -p lib logs
```

### Step 3: Create All Files

Create each file from this spec:
- package.json
- .env (get ANYSITE_API_KEY from user)
- .env.example
- ecosystem.config.js
- server.js
- worker.js
- lib/queue.js
- lib/anysite-client.js
- lib/tool-registry.js
- lib/callback.js

### Step 4: Install Dependencies

```bash
cd /home/ubuntu/anysignals
npm install
```

### Step 5: Configure Firewall

```bash
# Allow port 3456 for webhook traffic
sudo ufw allow 3456/tcp
sudo ufw status
```

### Step 6: Start Services

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions to persist across reboots
```

### Step 7: Test the Service

```bash
# Health check
curl http://localhost:3456/api/health

# Test single job (from VPS)
curl -X POST http://localhost:3456/api/single \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "tool": "get_linkedin_profile",
    "params": { "user": "https://linkedin.com/in/satlokomern" },
    "rowId": "test_001"
  }'

# Watch the queue
pm2 logs anysignals-worker
```

### Step 8: Test from External (Clay simulation)

From local machine or Clay HTTP action:

```bash
curl -X POST http://YOUR_VPS_IP:3456/api/batch \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "tool": "get_linkedin_profile",
    "records": [
      { "user": "https://linkedin.com/in/person1", "rowId": "row_1" },
      { "user": "https://linkedin.com/in/person2", "rowId": "row_2" }
    ]
  }'
```

---

## Clay Integration

### Option A: HTTP API Action (Push batch, poll for results)

1. In Clay, add an **HTTP API** action
2. Configure:
   - Method: POST
   - URL: `http://YOUR_VPS_IP:3456/api/batch`
   - Headers: `X-Webhook-Secret: YOUR_SECRET`
   - Body:
   ```json
   {
     "tool": "get_linkedin_profile",
     "records": {{JSON.stringify(rows.map(r => ({ user: r.linkedin_url, rowId: r._clayRowId })))}},
     "callbackUrl": "https://hooks.relay.app/your-workflow-id"
   }
   ```

### Option B: Webhook Trigger (Real-time results)

1. Set up a Relay workflow with Webhook trigger
2. Use that webhook URL as `callbackUrl` in AnySignals requests
3. Results flow back to Relay → can push to Clay table or HubSpot

---

## Security Considerations

1. **X-Webhook-Secret Header** - All requests must include this
2. **Firewall** - Only open port 3456, keep SSH locked down
3. **Rate Limiting** - Consider adding express-rate-limit for the webhook endpoint itself
4. **HTTPS** - For production, put behind nginx with Let's Encrypt SSL

---

## Monitoring & Debugging

```bash
# Watch real-time logs
pm2 logs

# Check queue depth
redis-cli LLEN bull:anysignals:jobs:wait

# Check completed jobs
redis-cli KEYS "anysignals:result:*"

# Check batch progress
redis-cli HGETALL "anysignals:batch:BATCH_ID"

# Restart if needed
pm2 restart all
```

---

## Ask the User For:

1. **AnySite API Key** - Required for .env
2. **Preferred port** - Default is 3456, can change
3. **VPS details** - Where Node projects live, Redis port if non-standard
4. **Webhook secret** - They can provide one or we generate

---

## Success Criteria

- [ ] `curl localhost:3456/api/health` returns healthy
- [ ] Single job queues and processes after 10 seconds
- [ ] Batch of 10 jobs completes in ~100 seconds (10 × 10s)
- [ ] Results stored in Redis and retrievable via /api/status
- [ ] Callback webhook fires for each completed job
- [ ] PM2 keeps services running after VPS reboot
