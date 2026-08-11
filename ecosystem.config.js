module.exports = {
  apps: [
    {
      name: 'pizza-bot',
      script: 'index.js',
      cwd: './bot',
      watch: false,
      env: {
        NODE_ENV: 'production',
        OUTLET: 'pizza'
      }
    },
    {
      name: 'cake-bot',
      script: 'index.js',
      cwd: './bot',
      watch: false,
      env: {
        NODE_ENV: 'production',
        OUTLET: 'cake'
      }
    }
  ]
};
