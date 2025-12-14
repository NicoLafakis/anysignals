/**
 * AnySignals Worker - BullMQ rate-limited job processor
 *
 * Processes jobs from the queue at a controlled rate (1 per 10 seconds by default)
 * to comply with AnySite API rate limits.
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const logger = require('./lib/logger');
const queue = require('./lib/queue');
const anysiteClient = require('./lib/anysite-client');
const callback = require('./lib/callback');
const { getTool, validateParams } = require('./lib/tool-registry');

// =============================================================================
// Configuration
// =============================================================================

const QUEUE_NAME = queue.QUEUE_NAME;
const DRIP_INTERVAL_MS = parseInt(process.env.DRIP_INTERVAL_MS, 10) || 10000;
const RESULT_TTL_SECONDS = parseInt(process.env.RESULT_TTL_SECONDS, 10) || 86400;

// Track if we're shutting down
let isShuttingDown = false;
let currentJob = null;

// =============================================================================
// Job Processor
// =============================================================================

/**
 * Process a single job
 * @param {Job} job - BullMQ job
 * @returns {Promise<object>} - Job result
 */
async function processJob(job) {
  const { tool, params, rowId, callbackUrl, batchId } = job.data;

  logger.info('Processing job', {
    jobId: job.id,
    tool,
    rowId,
    batchId: batchId || 'none',
    attempt: job.attemptsMade + 1
  });

  // 1. Get endpoint config from registry
  const config = getTool(tool);
  if (!config) {
    throw new Error(`Unknown tool: ${tool}`);
  }

  // 2. Validate required params
  const validation = validateParams(tool, params);
  if (!validation.valid) {
    throw new Error(`Missing required parameters: ${validation.missing.join(', ')}`);
  }

  // 3. Call AnySite API
  logger.debug('Calling AnySite API', {
    endpoint: config.endpoint,
    method: config.method
  });

  const response = await anysiteClient.request({
    method: config.method,
    endpoint: config.endpoint,
    data: params
  });

  logger.info('AnySite API call successful', {
    jobId: job.id,
    tool,
    rowId
  });

  // 4. Store result in Redis
  await queue.storeResult(job.id, batchId, {
    jobId: job.id,
    rowId,
    tool,
    data: response,
    completedAt: new Date().toISOString()
  });

  // 5. Update batch progress
  if (batchId) {
    await queue.updateBatchProgress(batchId, 'completed');
  }

  // 6. Fire callback if provided
  if (callbackUrl) {
    const callbackResult = await callback.sendCompletedCallback(job, response);
    if (!callbackResult.success) {
      logger.warn('Callback delivery failed', {
        jobId: job.id,
        rowId,
        error: callbackResult.error
      });
      // Don't fail the job if callback fails - the job itself succeeded
    }
  }

  return response;
}

/**
 * Handle job failure
 * @param {Job} job - BullMQ job
 * @param {Error} error - The error that caused failure
 */
async function handleJobFailure(job, error) {
  const { tool, rowId, callbackUrl, batchId } = job.data;
  const isFinalAttempt = job.attemptsMade >= job.opts.attempts;

  logger.error('Job processing failed', {
    jobId: job.id,
    tool,
    rowId,
    batchId: batchId || 'none',
    attempt: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    isFinalAttempt,
    error: error.message
  });

  // Only update batch and send callback on final failure
  if (isFinalAttempt) {
    // Update batch progress
    if (batchId) {
      await queue.updateBatchProgress(batchId, 'failed');
    }

    // Store failure result
    await queue.storeResult(job.id, batchId, {
      jobId: job.id,
      rowId,
      tool,
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });

    // Send failure callback
    if (callbackUrl) {
      await callback.sendFailedCallback(job, error.message);
    }
  }
}

// =============================================================================
// Worker Setup
// =============================================================================

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    currentJob = job;
    try {
      return await processJob(job);
    } finally {
      currentJob = null;
    }
  },
  {
    connection: queue.getRedisConnection(),

    // Rate limiter: 1 job per DRIP_INTERVAL_MS
    limiter: {
      max: 1,
      duration: DRIP_INTERVAL_MS
    },

    // Only process one job at a time
    concurrency: 1,

    // Lock jobs for 5 minutes (in case of slow API calls)
    lockDuration: 300000,

    // Renew lock every 30 seconds
    lockRenewTime: 30000
  }
);

// =============================================================================
// Worker Events
// =============================================================================

worker.on('ready', () => {
  logger.info('Worker is ready', {
    queue: QUEUE_NAME,
    dripInterval: `${DRIP_INTERVAL_MS}ms`,
    ratePerMinute: 60000 / DRIP_INTERVAL_MS
  });

  // Signal PM2 that we're ready
  if (process.send) {
    process.send('ready');
  }
});

worker.on('active', (job) => {
  logger.debug('Job active', {
    jobId: job.id,
    tool: job.data.tool,
    rowId: job.data.rowId
  });
});

worker.on('completed', (job, result) => {
  logger.info('Job completed', {
    jobId: job.id,
    tool: job.data.tool,
    rowId: job.data.rowId,
    duration: `${Date.now() - job.timestamp}ms`
  });
});

worker.on('failed', async (job, error) => {
  await handleJobFailure(job, error);
});

worker.on('error', (error) => {
  logger.error('Worker error', { error: error.message });
});

worker.on('stalled', (jobId) => {
  logger.warn('Job stalled', { jobId });
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function shutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Wait for current job to complete (if any)
  if (currentJob) {
    logger.info('Waiting for current job to complete...', {
      jobId: currentJob.id,
      tool: currentJob.data.tool
    });
  }

  try {
    // Close worker (waits for current job)
    await worker.close();
    logger.info('Worker closed');

    // Close queue connections
    await queue.shutdown();
    logger.info('Queue connections closed');

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: reason?.toString() });
});

// =============================================================================
// Startup
// =============================================================================

logger.info('AnySignals worker starting...', {
  queue: QUEUE_NAME,
  dripInterval: `${DRIP_INTERVAL_MS}ms`,
  resultTTL: `${RESULT_TTL_SECONDS}s`,
  environment: process.env.NODE_ENV || 'development'
});
