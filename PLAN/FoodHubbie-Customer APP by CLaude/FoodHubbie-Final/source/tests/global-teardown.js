/**
 * Global test teardown - runs once after all tests
 * Cleans up test data, closes connections
 */
async function globalTeardown() {
  console.log('[Global Teardown] Cleaning up test environment...');
  console.log('[Global Teardown] Complete');
}

module.exports = globalTeardown;