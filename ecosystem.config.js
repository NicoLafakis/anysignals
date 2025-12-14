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
      merge_logs: true,
      time: true
    },
    {
      name: 'anysignals-worker',
      script: 'worker.js',
      instances: 1, // MUST be 1 for rate limiting to work correctly
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true,
      time: true,
      // Graceful shutdown - give worker time to finish current job
      kill_timeout: 30000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};
