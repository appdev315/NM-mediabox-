module.exports = {
  apps: [
    {
      name: 'mediabox-backend',
      script: 'index.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster', // Enables Node.js cluster mode
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'go-microservice',
      script: './go-server',
      instances: 1, // Go runs its own highly concurrent HTTP server
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
