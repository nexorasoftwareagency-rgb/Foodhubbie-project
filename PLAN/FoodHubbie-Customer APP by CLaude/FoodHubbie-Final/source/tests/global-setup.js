/**
 * Global test setup - runs once before all tests
 * Clears service worker caches, sets up test environment
 */
async function globalSetup() {
  console.log('[Global Setup] Starting test environment preparation...');
  
  // Ensure test output directory exists
  const fs = require('fs');
  const path = require('path');
  const resultsDir = path.join(__dirname, 'test-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  console.log('[Global Setup] Complete');
}

module.exports = globalSetup;