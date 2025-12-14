/**
 * Callback Handler - Webhook callback delivery with retry logic
 */

const axios = require('axios');
const logger = require('./logger');

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a callback webhook with retry logic
 *
 * @param {string} callbackUrl - URL to POST the callback to
 * @param {object} payload - Data to send in the callback
 * @param {object} options - Optional configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: from env or 3)
 * @param {number} options.timeout - Request timeout in ms (default: from env or 10000)
 * @param {number} options.baseDelay - Base delay for exponential backoff (default: from env or 1000)
 * @returns {Promise<{success: boolean, attempts: number, error?: string}>}
 */
async function sendCallback(callbackUrl, payload, options = {}) {
  const {
    maxRetries = parseInt(process.env.CALLBACK_MAX_RETRIES, 10) || 3,
    timeout = parseInt(process.env.CALLBACK_TIMEOUT_MS, 10) || 10000,
    baseDelay = parseInt(process.env.CALLBACK_RETRY_DELAY_MS, 10) || 1000
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug('Sending callback', {
        attempt,
        url: callbackUrl,
        jobId: payload.jobId,
        rowId: payload.rowId
      });

      const response = await axios.post(callbackUrl, payload, {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AnySignals/1.0',
          'X-AnySignals-Attempt': attempt.toString()
        }
      });

      logger.info('Callback delivered successfully', {
        url: callbackUrl,
        jobId: payload.jobId,
        rowId: payload.rowId,
        status: response.status,
        attempts: attempt
      });

      return {
        success: true,
        attempts: attempt,
        status: response.status
      };

    } catch (error) {
      lastError = error;

      const shouldRetry = isRetryableCallbackError(error) && attempt < maxRetries;

      if (shouldRetry) {
        const delay = calculateBackoff(attempt, baseDelay);
        logger.warn('Callback failed, retrying...', {
          attempt,
          maxRetries,
          url: callbackUrl,
          jobId: payload.jobId,
          error: getErrorMessage(error),
          retryInMs: delay
        });
        await sleep(delay);
      } else {
        logger.error('Callback delivery failed', {
          attempt,
          url: callbackUrl,
          jobId: payload.jobId,
          rowId: payload.rowId,
          error: getErrorMessage(error),
          status: error.response?.status
        });
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    attempts: maxRetries,
    error: getErrorMessage(lastError)
  };
}

/**
 * Determine if a callback error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
function isRetryableCallbackError(error) {
  // Network errors
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED'].includes(error.code)) {
    return true;
  }

  // Timeout
  if (error.message?.includes('timeout')) {
    return true;
  }

  // Rate limiting
  if (error.response?.status === 429) {
    return true;
  }

  // Server errors (5xx)
  if (error.response?.status >= 500) {
    return true;
  }

  // Client errors (4xx except 429) are not retryable
  if (error.response?.status >= 400 && error.response?.status < 500) {
    return false;
  }

  return false;
}

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - Current attempt (1-indexed)
 * @param {number} baseDelay - Base delay in ms
 * @returns {number} - Delay in ms
 */
function calculateBackoff(attempt, baseDelay) {
  const maxDelay = 30000; // 30 seconds max
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * Extract error message
 * @param {Error} error - The error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  if (error.message) {
    return error.message;
  }
  return 'Unknown callback error';
}

/**
 * Build callback payload for a completed job
 *
 * @param {object} job - BullMQ job
 * @param {object} result - Job result data
 * @param {'completed'|'failed'} status - Job status
 * @param {string} error - Error message if failed
 * @returns {object} - Formatted callback payload
 */
function buildCallbackPayload(job, result, status, error = null) {
  const payload = {
    jobId: job.id,
    rowId: job.data.rowId,
    batchId: job.data.batchId || null,
    tool: job.data.tool,
    status,
    processedAt: new Date().toISOString()
  };

  if (status === 'completed') {
    payload.data = result;
  } else {
    payload.error = error;
    payload.attempts = job.attemptsMade;
  }

  return payload;
}

/**
 * Send callback for a completed job (convenience method)
 *
 * @param {object} job - BullMQ job
 * @param {object} result - Job result data
 * @returns {Promise<{success: boolean, attempts: number, error?: string}>}
 */
async function sendCompletedCallback(job, result) {
  if (!job.data.callbackUrl) {
    return { success: true, attempts: 0, skipped: true };
  }

  const payload = buildCallbackPayload(job, result, 'completed');
  return sendCallback(job.data.callbackUrl, payload);
}

/**
 * Send callback for a failed job (convenience method)
 *
 * @param {object} job - BullMQ job
 * @param {string} errorMessage - Error message
 * @returns {Promise<{success: boolean, attempts: number, error?: string}>}
 */
async function sendFailedCallback(job, errorMessage) {
  if (!job.data.callbackUrl) {
    return { success: true, attempts: 0, skipped: true };
  }

  const payload = buildCallbackPayload(job, null, 'failed', errorMessage);
  return sendCallback(job.data.callbackUrl, payload);
}

module.exports = {
  sendCallback,
  buildCallbackPayload,
  sendCompletedCallback,
  sendFailedCallback
};
