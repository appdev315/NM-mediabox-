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
    }
  ]
};
