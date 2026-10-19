module.exports = {
  apps: [
    {
      name: 'bot-roshani-pizza-pizza',
      script: 'index.js',
      cwd: './bot',
      watch: false,
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
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        OUTLET: 'cake'
      }
    }
  ]
};
