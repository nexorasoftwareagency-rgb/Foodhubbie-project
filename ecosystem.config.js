module.exports = {
  apps: [
    {
      name: 'bot-roshani-pizza-pizza',
      script: 'index.js',
      cwd: './bot',
      watch: false,
      // Back off repeated restarts so a persistent startup failure cannot hot-loop
      // (pairs with the [FATAL] exit-on-uncaught-exception handlers in index.js).
      exp_backoff_restart_delay: 500,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        OUTLET: 'pizza'
      }
    },
    {
      name: 'bot-roshani-cake-cake',
      script: 'index.js',
      cwd: './bot',
      watch: false,
      exp_backoff_restart_delay: 500,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        OUTLET: 'cake'
      }
    }
  ]
};
