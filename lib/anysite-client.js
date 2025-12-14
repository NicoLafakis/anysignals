/**
 * AnySite API Client - HTTP client for AnySite REST API with retry logic
 */

const axios = require('axios');
const logger = require('./logger');

// Create axios instance with default configuration
const createClient = () => {
  const baseURL = process.env.ANYSITE_BASE_URL || 'https://mcp.anysite.io/mcp';
  const apiKey = process.env.ANYSITE_API_KEY;

  if (!apiKey) {
    logger.warn('ANYSITE_API_KEY not set - API calls will fail');
  }

  return axios.create({
    baseURL,
    timeout: 60000, // 60 second default timeout
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  });
};

let client = null;

/**
 * Get or create the API client
 * @returns {AxiosInstance}
 */
function getClient() {
  if (!client) {
    client = createClient();
  }
  return client;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a request to the AnySite API with retry logic
 *
 * @param {object} options - Request options
 * @param {string} options.method - HTTP method
 * @param {string} options.endpoint - API endpoint path
 * @param {object} options.data - Request body data
 * @param {number} options.timeout - Optional custom timeout
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @returns {Promise<object>} - API response data
 */
async function request(options) {
  const {
    method = 'POST',
    endpoint,
    data,
    timeout,
    maxRetries = 3
  } = options;

  const apiClient = getClient();
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug('AnySite API request', {
        attempt,
        method,
        endpoint,
        dataKeys: Object.keys(data || {})
      });

      const response = await apiClient.request({
        method,
        url: endpoint,
        data,
        timeout: timeout || 60000
      });

      logger.debug('AnySite API response', {
        status: response.status,
        hasData: !!response.data
      });

      return response.data;

    } catch (error) {
      lastError = error;

      // Determine if we should retry
      const shouldRetry = isRetryableError(error) && attempt < maxRetries;

      if (shouldRetry) {
        const delay = getRetryDelay(attempt);
        logger.warn('AnySite API request failed, retrying...', {
          attempt,
          maxRetries,
          endpoint,
          error: getErrorMessage(error),
          retryInMs: delay
        });
        await sleep(delay);
      } else {
        // Log final failure
        logger.error('AnySite API request failed', {
          attempt,
          endpoint,
          error: getErrorMessage(error),
          status: error.response?.status,
          responseData: error.response?.data
        });
      }
    }
  }

  // All retries exhausted
  throw formatError(lastError, endpoint);
}

/**
 * Determine if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
function isRetryableError(error) {
  // Network errors are retryable
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND') {
    return true;
  }

  // Timeout errors are retryable
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return true;
  }

  // Rate limiting (429) is retryable
  if (error.response?.status === 429) {
    return true;
  }

  // Server errors (5xx) are retryable
  if (error.response?.status >= 500) {
    return true;
  }

  // 4xx errors (except 429) are not retryable
  if (error.response?.status >= 400 && error.response?.status < 500) {
    return false;
  }

  return false;
}

/**
 * Calculate retry delay with exponential backoff
 * @param {number} attempt - Current attempt number (1-indexed)
 * @returns {number} - Delay in milliseconds
 */
function getRetryDelay(attempt) {
  const baseDelay = 1000; // 1 second
  const maxDelay = 30000; // 30 seconds
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * Extract error message from various error types
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
  return 'Unknown error';
}

/**
 * Format error for throwing
 * @param {Error} error - The original error
 * @param {string} endpoint - The endpoint that failed
 * @returns {Error}
 */
function formatError(error, endpoint) {
  const message = getErrorMessage(error);
  const status = error.response?.status;

  const formattedError = new Error(`AnySite API error: ${message}`);
  formattedError.endpoint = endpoint;
  formattedError.status = status;
  formattedError.originalError = error;
  formattedError.responseData = error.response?.data;

  return formattedError;
}

/**
 * Convenience method for POST requests
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body
 * @param {object} options - Additional options
 * @returns {Promise<object>}
 */
async function post(endpoint, data, options = {}) {
  return request({
    method: 'POST',
    endpoint,
    data,
    ...options
  });
}

/**
 * Convenience method for GET requests
 * @param {string} endpoint - API endpoint
 * @param {object} options - Additional options
 * @returns {Promise<object>}
 */
async function get(endpoint, options = {}) {
  return request({
    method: 'GET',
    endpoint,
    ...options
  });
}

/**
 * Check API connectivity
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    // Try a simple request - adjust endpoint as needed
    await getClient().get('/health', { timeout: 5000 });
    return true;
  } catch (error) {
    // Even if health endpoint doesn't exist, connection might be okay
    // Check if we got an HTTP response (meaning server is reachable)
    if (error.response) {
      return true;
    }
    return false;
  }
}

module.exports = {
  request,
  post,
  get,
  healthCheck,
  getClient
};
