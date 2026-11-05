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
    }
    // The cake bot was removed 2026-10-27 (owner: re-add later from Supreme Admin
    // if needed). Bots provisioned via Supreme Admin / bot-control-api orchestrator
    // are started by pm2 directly and are not listed here.
  ]
};
