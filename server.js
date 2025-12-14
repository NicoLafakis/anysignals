/**
 * AnySignals Server - Express webhook receiver for rate-limited AnySite API processing
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

const logger = require('./lib/logger');
const queue = require('./lib/queue');
const { toolExists, listTools } = require('./lib/tool-registry');

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT, 10) || 3456;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE, 10) || 2000;
const DRIP_INTERVAL_MS = parseInt(process.env.DRIP_INTERVAL_MS, 10) || 10000;

// =============================================================================
// Validation Schemas
// =============================================================================

const batchSchema = Joi.object({
  tool: Joi.string().required(),
  records: Joi.array().items(Joi.object()).min(1).max(MAX_BATCH_SIZE).required(),
  callbackUrl: Joi.string().uri().optional(),
  priority: Joi.number().integer().min(1).max(10).default(5)
});

const singleSchema = Joi.object({
  tool: Joi.string().required(),
  params: Joi.object().required(),
  callbackUrl: Joi.string().uri().optional(),
  rowId: Joi.string().optional(),
  priority: Joi.number().integer().min(1).max(10).default(5)
});

// =============================================================================
// Express App Setup
// =============================================================================

const app = express();

// Security middleware
app.use(helmet());

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
});

// Rate limiting for API endpoints (prevent abuse of the webhook receiver itself)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

// =============================================================================
// Authentication Middleware
// =============================================================================

function authenticateRequest(req, res, next) {
  // Skip auth for health endpoint
  if (req.path === '/api/health') {
    return next();
  }

  const providedSecret = req.headers['x-webhook-secret'];

  if (!WEBHOOK_SECRET) {
    logger.warn('WEBHOOK_SECRET not configured - requests are not authenticated');
    return next();
  }

  if (!providedSecret) {
    logger.warn('Request missing X-Webhook-Secret header', { ip: req.ip });
    return res.status(401).json({
      error: 'Missing X-Webhook-Secret header'
    });
  }

  if (providedSecret !== WEBHOOK_SECRET) {
    logger.warn('Invalid webhook secret provided', { ip: req.ip });
    return res.status(403).json({
      error: 'Invalid webhook secret'
    });
  }

  next();
}

// Apply auth to all /api routes except health
app.use('/api', authenticateRequest);

// =============================================================================
// API Endpoints
// =============================================================================

/**
 * Health Check
 * GET /api/health
 */
app.get('/api/health', async (req, res) => {
  try {
    const redisConnected = await queue.isRedisConnected();
    const stats = await queue.getQueueStats();

    const status = {
      status: redisConnected ? 'healthy' : 'degraded',
      redis: redisConnected ? 'connected' : 'disconnected',
      queueDepth: stats.total,
      waiting: stats.waiting,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    };

    const statusCode = redisConnected ? 200 : 503;
    res.status(statusCode).json(status);

  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Queue a batch of records
 * POST /api/batch
 */
app.post('/api/batch', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = batchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message)
      });
    }

    const { tool, records, callbackUrl, priority } = value;

    // Validate tool exists
    if (!toolExists(tool)) {
      return res.status(400).json({
        error: `Unknown tool: ${tool}`,
        availableTools: listTools()
      });
    }

    // Generate batch ID
    const batchId = `batch_${uuidv4().split('-')[0]}`;

    // Add jobs to queue
    const jobs = await queue.addBatch(batchId, tool, records, callbackUrl, priority);

    // Calculate estimated completion time
    const estimatedSeconds = Math.ceil((records.length * DRIP_INTERVAL_MS) / 1000);

    logger.info('Batch queued successfully', {
      batchId,
      tool,
      recordCount: records.length,
      callbackUrl: callbackUrl ? 'set' : 'none',
      priority
    });

    res.status(202).json({
      success: true,
      batchId,
      jobsQueued: jobs.length,
      estimatedCompletionSeconds: estimatedSeconds,
      statusUrl: `/api/status/${batchId}`
    });

  } catch (error) {
    logger.error('Failed to queue batch', { error: error.message });
    res.status(500).json({
      error: 'Failed to queue batch',
      message: error.message
    });
  }
});

/**
 * Queue a single record
 * POST /api/single
 */
app.post('/api/single', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = singleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message)
      });
    }

    const { tool, params, callbackUrl, rowId, priority } = value;

    // Validate tool exists
    if (!toolExists(tool)) {
      return res.status(400).json({
        error: `Unknown tool: ${tool}`,
        availableTools: listTools()
      });
    }

    // Get queue position
    const { position, estimatedWaitSeconds } = await queue.getQueuePosition();

    // Add job to queue
    const job = await queue.addJob({
      tool,
      params,
      rowId: rowId || `single_${uuidv4().split('-')[0]}`,
      callbackUrl,
      batchId: null
    }, { priority });

    logger.info('Single job queued', {
      jobId: job.id,
      tool,
      rowId: job.data.rowId,
      position,
      callbackUrl: callbackUrl ? 'set' : 'none'
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      rowId: job.data.rowId,
      position,
      estimatedWaitSeconds
    });

  } catch (error) {
    logger.error('Failed to queue single job', { error: error.message });
    res.status(500).json({
      error: 'Failed to queue job',
      message: error.message
    });
  }
});

/**
 * Check batch status
 * GET /api/status/:batchId
 */
app.get('/api/status/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;

    const status = await queue.getBatchStatus(batchId);

    if (!status) {
      return res.status(404).json({
        error: 'Batch not found',
        batchId
      });
    }

    // Get results if requested
    const includeResults = req.query.results === 'true';
    let results = [];

    if (includeResults) {
      const limit = parseInt(req.query.limit, 10) || 100;
      results = await queue.getBatchResults(batchId, limit);
    }

    res.json({
      ...status,
      results: includeResults ? results : undefined
    });

  } catch (error) {
    logger.error('Failed to get batch status', { error: error.message });
    res.status(500).json({
      error: 'Failed to get batch status',
      message: error.message
    });
  }
});

/**
 * List available tools
 * GET /api/tools
 */
app.get('/api/tools', (req, res) => {
  const { getToolsByCategory, TOOL_REGISTRY } = require('./lib/tool-registry');

  res.json({
    tools: listTools(),
    byCategory: getToolsByCategory(),
    total: listTools().length
  });
});

/**
 * Get queue statistics
 * GET /api/stats
 */
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await queue.getQueueStats();
    const dripRate = 60000 / DRIP_INTERVAL_MS; // jobs per minute

    res.json({
      queue: stats,
      config: {
        dripIntervalMs: DRIP_INTERVAL_MS,
        dripRatePerMinute: dripRate,
        maxBatchSize: MAX_BATCH_SIZE
      },
      estimatedDrainTimeSeconds: Math.ceil((stats.total * DRIP_INTERVAL_MS) / 1000)
    });

  } catch (error) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

// =============================================================================
// Error Handling
// =============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function shutdown(signal) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await queue.shutdown();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// =============================================================================
// Start Server
// =============================================================================

const server = app.listen(PORT, () => {
  logger.info('AnySignals server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    dripInterval: `${DRIP_INTERVAL_MS}ms`,
    maxBatchSize: MAX_BATCH_SIZE
  });

  // Signal PM2 that we're ready
  if (process.send) {
    process.send('ready');
  }
});

module.exports = app;
