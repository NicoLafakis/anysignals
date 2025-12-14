/**
 * Queue Setup - BullMQ queue configuration and helpers
 */

const { Queue, QueueEvents } = require('bullmq');
const Redis = require('ioredis');
const logger = require('./logger');

// Redis connection (shared across queue and worker)
let redisConnection = null;

/**
 * Get or create Redis connection
 * @returns {Redis}
 */
function getRedisConnection() {
  if (!redisConnection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false
    });

    redisConnection.on('connect', () => {
      logger.info('Redis connected');
    });

    redisConnection.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    redisConnection.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }
  return redisConnection;
}

// Queue name constant
const QUEUE_NAME = 'anysignals:jobs';

// Queue instance (singleton)
let queueInstance = null;

/**
 * Get or create the job queue
 * @returns {Queue}
 */
function getQueue() {
  if (!queueInstance) {
    queueInstance = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000 // Start with 5 second delay, then 10s, then 20s
        },
        removeOnComplete: {
          count: 1000, // Keep last 1000 completed jobs
          age: 24 * 3600 // Keep completed jobs for 24 hours
        },
        removeOnFail: {
          count: 500, // Keep last 500 failed jobs for debugging
          age: 7 * 24 * 3600 // Keep failed jobs for 7 days
        }
      }
    });

    queueInstance.on('error', (err) => {
      logger.error('Queue error', { error: err.message });
    });
  }
  return queueInstance;
}

/**
 * Add a single job to the queue
 * @param {object} jobData - Job data including tool, params, rowId, callbackUrl, batchId
 * @param {object} options - Optional job options (priority, delay, etc.)
 * @returns {Promise<Job>}
 */
async function addJob(jobData, options = {}) {
  const queue = getQueue();
  const jobOptions = {
    priority: options.priority || 5,
    ...options
  };

  const job = await queue.add('process-record', jobData, jobOptions);
  logger.debug('Job added to queue', {
    jobId: job.id,
    tool: jobData.tool,
    rowId: jobData.rowId
  });
  return job;
}

/**
 * Add multiple jobs to the queue (batch)
 * @param {string} batchId - Unique batch identifier
 * @param {string} tool - Tool name for all jobs
 * @param {array} records - Array of record objects with params and rowId
 * @param {string} callbackUrl - Optional callback URL for results
 * @param {number} priority - Optional priority (1=high, 10=low)
 * @returns {Promise<Job[]>}
 */
async function addBatch(batchId, tool, records, callbackUrl, priority = 5) {
  const queue = getQueue();
  const redis = getRedisConnection();

  // Initialize batch tracking in Redis
  await redis.hset(`anysignals:batch:${batchId}`, {
    total: records.length,
    completed: 0,
    failed: 0,
    createdAt: new Date().toISOString(),
    tool
  });

  // Set TTL on batch data (48 hours)
  await redis.expire(`anysignals:batch:${batchId}`, 48 * 3600);

  // Prepare bulk job data
  const jobs = records.map((record, index) => ({
    name: 'process-record',
    data: {
      tool,
      params: record,
      rowId: record.rowId || `${batchId}_${index}`,
      callbackUrl,
      batchId
    },
    opts: {
      priority
    }
  }));

  // Add all jobs in bulk
  const addedJobs = await queue.addBulk(jobs);

  logger.info('Batch added to queue', {
    batchId,
    tool,
    jobCount: addedJobs.length,
    callbackUrl: callbackUrl ? 'set' : 'none'
  });

  return addedJobs;
}

/**
 * Get queue statistics
 * @returns {Promise<object>}
 */
async function getQueueStats() {
  const queue = getQueue();

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed
  };
}

/**
 * Get batch status
 * @param {string} batchId - Batch identifier
 * @returns {Promise<object|null>}
 */
async function getBatchStatus(batchId) {
  const redis = getRedisConnection();
  const batchData = await redis.hgetall(`anysignals:batch:${batchId}`);

  if (!batchData || Object.keys(batchData).length === 0) {
    return null;
  }

  const total = parseInt(batchData.total, 10);
  const completed = parseInt(batchData.completed, 10);
  const failed = parseInt(batchData.failed, 10);
  const pending = total - completed - failed;
  const dripInterval = parseInt(process.env.DRIP_INTERVAL_MS, 10) || 10000;

  return {
    batchId,
    total,
    completed,
    failed,
    pending,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    estimatedRemainingSeconds: Math.ceil((pending * dripInterval) / 1000),
    createdAt: batchData.createdAt,
    tool: batchData.tool
  };
}

/**
 * Get results for a batch
 * @param {string} batchId - Batch identifier
 * @param {number} limit - Max results to return
 * @returns {Promise<array>}
 */
async function getBatchResults(batchId, limit = 100) {
  const redis = getRedisConnection();
  const pattern = `anysignals:result:*:${batchId}`;

  const keys = await redis.keys(pattern);
  const limitedKeys = keys.slice(0, limit);

  if (limitedKeys.length === 0) {
    return [];
  }

  const results = await Promise.all(
    limitedKeys.map(async (key) => {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    })
  );

  return results.filter(Boolean);
}

/**
 * Store a job result in Redis
 * @param {string} jobId - Job ID
 * @param {string} batchId - Optional batch ID
 * @param {object} result - Result data
 */
async function storeResult(jobId, batchId, result) {
  const redis = getRedisConnection();
  const ttl = parseInt(process.env.RESULT_TTL_SECONDS, 10) || 86400;

  const key = batchId
    ? `anysignals:result:${jobId}:${batchId}`
    : `anysignals:result:${jobId}`;

  await redis.setex(key, ttl, JSON.stringify({
    ...result,
    storedAt: new Date().toISOString()
  }));
}

/**
 * Update batch progress (increment completed or failed count)
 * @param {string} batchId - Batch identifier
 * @param {'completed'|'failed'} field - Field to increment
 */
async function updateBatchProgress(batchId, field) {
  if (!batchId) return;

  const redis = getRedisConnection();
  await redis.hincrby(`anysignals:batch:${batchId}`, field, 1);
}

/**
 * Get estimated wait time for a new job
 * @returns {Promise<{position: number, estimatedWaitSeconds: number}>}
 */
async function getQueuePosition() {
  const stats = await getQueueStats();
  const position = stats.waiting + stats.active + 1;
  const dripInterval = parseInt(process.env.DRIP_INTERVAL_MS, 10) || 10000;

  return {
    position,
    estimatedWaitSeconds: Math.ceil((position * dripInterval) / 1000)
  };
}

/**
 * Check if Redis is connected
 * @returns {Promise<boolean>}
 */
async function isRedisConnected() {
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    return false;
  }
}

/**
 * Graceful shutdown - close connections
 */
async function shutdown() {
  logger.info('Shutting down queue connections...');

  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  logger.info('Queue connections closed');
}

module.exports = {
  QUEUE_NAME,
  getRedisConnection,
  getQueue,
  addJob,
  addBatch,
  getQueueStats,
  getBatchStatus,
  getBatchResults,
  storeResult,
  updateBatchProgress,
  getQueuePosition,
  isRedisConnected,
  shutdown
};
