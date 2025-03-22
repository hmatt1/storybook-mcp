/**
 * Integration tests for Storybook MCP Server
 * 
 * This script tests the functionality of the MCP server by:
 * 1. Checking server health
 * 2. Listing available components
 * 3. Capturing screenshots of components
 * 4. Verifying results
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Constants
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';
const HEALTH_CHECK_URL = `${MCP_SERVER_URL}/health`;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './test-output';
const MAX_RETRIES = 30;
const RETRY_DELAY = 2000;

// Setup for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test Results
const testResults = {
  passed: 0,
  failed: 0,
  screenshots: []
};

/**
 * HTTP transport for the MCP client following the JSON-RPC protocol
 */
class HTTPTransport {
  constructor(url) {
    this.url = url;
  }

  async sendRequest(request) {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async subscribe(callback) {
    // For simple tests we don't need subscription handling
    return () => {};
  }

  async close() {
    // No resources to clean up
  }
}

/**
 * Wait for a specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Log with timestamp and color based on status
 * @param {string} message - Message to log
 * @param {'info'|'success'|'error'|'warning'} status - Log status
 */
function log(message, status = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const colors = {
    info: '\x1b[36m', // Cyan
    success: '\x1b[32m', // Green
    error: '\x1b[31m', // Red
    warning: '\x1b[33m', // Yellow
    reset: '\x1b[0m' // Reset
  };
  
  console.log(`${colors[status]}[${timestamp}] ${message}${colors.reset}`);
}

/**
 * Wait for server to be healthy
 * @returns {Promise<boolean>}
 */
async function waitForServerHealth() {
  log('Waiting for MCP server to become healthy...', 'info');
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(HEALTH_CHECK_URL, { timeout: 5000 });
      
      if (response.ok) {
        const data = await response.json();
        log(`Server is healthy! Connected to Storybook at ${data.storybookUrl}`, 'success');
        return true;
      }
    } catch (error) {
      // Just continue to retry
    }
    
    log(`Health check attempt ${attempt}/${MAX_RETRIES} failed, retrying...`, 'warning');
    await sleep(RETRY_DELAY);
  }
  
  log('Server health check failed after maximum retries', 'error');
  return false;
}

/**
 * Initialize MCP client
 * @returns {Promise<Client>}
 */
async function initMcpClient() {
  log('Initializing MCP client...', 'info');
  
  // Create client based on the documentation example
  const transport = new HTTPTransport(MCP_SERVER_URL);
  
  const client = new Client(
    { name: "StorybookMcpTester", version: "1.0.0" },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {}
      }
    }
  );
  
  await client.connect(transport);
  
  log('MCP client connected successfully', 'success');
  return client;
}

/**
 * Run a test and report results
 * @param {string} name - Test name
 * @param {Function} testFn - Test function to run
 */
async function runTest(name, testFn) {
  log(`Running test: ${name}`, 'info');
  
  try {
    await testFn();
    testResults.passed++;
    log(`✓ Test passed: ${name}`, 'success');
  } catch (error) {
    testResults.failed++;
    log(`✗ Test failed: ${name}`, 'error');
    log(`Error: ${error.message}`, 'error');
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Test component listing functionality
 * @param {Client} client - MCP client
 */
async function testComponentListing(client) {
  const response = await client.callTool({
    name: 'components',
    arguments: {}
  });
  
  if (!response || !response.content || response.content.length === 0) {
    throw new Error('No content in components response');
  }
  
  const contentText = response.content[0].text;
  const result = JSON.parse(contentText);
  
  if (!result.success) {
    throw new Error(`Failed to list components: ${result.error}`);
  }
  
  if (!result.components || !Array.isArray(result.components) || result.components.length === 0) {
    throw new Error('No components found in response');
  }
  
  log(`Found ${result.count} components`, 'info');
  return result.components;
}

/**
 * Test screenshot capture functionality
 * @param {Client} client - MCP client
 * @param {Object} component - Component to capture
 */
async function testScreenshotCapture(client, component) {
  if (!component || !component.variants || component.variants.length === 0) {
    throw new Error('Invalid component or no variants available');
  }
  
  const variant = component.variants[0];
  
  // Default state
  const defaultResponse = await client.callTool({
    name: 'capture',
    arguments: {
      component: variant.id,
      variant: variant.name,
      state: {},
      viewport: { width: 800, height: 600 }
    }
  });
  
  if (!defaultResponse || !defaultResponse.content || defaultResponse.content.length === 0) {
    throw new Error('No content in capture response');
  }
  
  const defaultResult = JSON.parse(defaultResponse.content[0].text);
  
  if (!defaultResult.success) {
    throw new Error(`Failed to capture screenshot: ${defaultResult.error}`);
  }
  
  // Check if file exists
  await assertFileExists(defaultResult.screenshotPath);
  testResults.screenshots.push(defaultResult.screenshotPath);
  
  // Hover state
  const hoverResponse = await client.callTool({
    name: 'capture',
    arguments: {
      component: variant.id,
      variant: variant.name,
      state: { hover: true },
      viewport: { width: 800, height: 600 }
    }
  });
  
  const hoverResult = JSON.parse(hoverResponse.content[0].text);
  
  if (!hoverResult.success) {
    throw new Error(`Failed to capture hover screenshot: ${hoverResult.error}`);
  }
  
  await assertFileExists(hoverResult.screenshotPath);
  testResults.screenshots.push(hoverResult.screenshotPath);
  
  log(`Successfully captured screenshots for ${component.name} (${variant.name})`, 'success');
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to the file
 */
async function assertFileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Path exists but is not a file: ${filePath}`);
    }
  } catch (error) {
    throw new Error(`Screenshot file not found: ${filePath}`);
  }
}

/**
 * Verify the output directory contains expected files
 */
async function verifyOutputDirectory() {
  log(`Verifying output directory: ${OUTPUT_DIR}`, 'info');
  
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    const pngFiles = files.filter(file => file.endsWith('.png'));
    
    if (pngFiles.length === 0) {
      throw new Error('No PNG files found in output directory');
    }
    
    log(`Found ${pngFiles.length} PNG files in output directory`, 'success');
  } catch (error) {
    throw new Error(`Failed to verify output directory: ${error.message}`);
  }
}

/**
 * Print test results summary
 */
function printResults() {
  console.log('\n=================================');
  console.log('       TEST RESULTS SUMMARY       ');
  console.log('=================================');
  
  if (testResults.failed === 0) {
    log(`All tests passed! (${testResults.passed} tests)`, 'success');
  } else {
    log(`Tests: ${testResults.passed} passed, ${testResults.failed} failed`, 
      testResults.failed > 0 ? 'error' : 'success');
  }
  
  log(`Generated ${testResults.screenshots.length} screenshots`, 'info');
  
  testResults.screenshots.forEach(screenshot => {
    const filename = path.basename(screenshot);
    log(`  - ${filename}`, 'info');
  });
  
  console.log('=================================');
}

/**
 * Main test function
 */
async function runTests() {
  try {
    // Wait for server to be healthy
    const isHealthy = await waitForServerHealth();
    if (!isHealthy) {
      process.exit(1);
    }
    
    // Connect to MCP server
    const client = await initMcpClient();
    
    // Run tests
    await runTest('Component Listing', async () => {
      const components = await testComponentListing(client);
      
      // Test screenshot capture for the first component
      if (components.length > 0) {
        await runTest('Screenshot Capture', async () => {
          await testScreenshotCapture(client, components[0]);
        });
        
        // Test screenshot capture with different viewport
        await runTest('Responsive Screenshot', async () => {
          const component = components[0];
          const variant = component.variants[0];
          
          const response = await client.callTool({
            name: 'capture',
            arguments: {
              component: variant.id,
              variant: variant.name,
              state: {},
              viewport: { width: 375, height: 667 }
            }
          });
          
          const result = JSON.parse(response.content[0].text);
          
          if (!result.success) {
            throw new Error(`Failed to capture responsive screenshot: ${result.error}`);
          }
          
          await assertFileExists(result.screenshotPath);
          testResults.screenshots.push(result.screenshotPath);
        });
      }
    });
    
    // Verify output directory
    await runTest('Output Directory Verification', verifyOutputDirectory);
    
    // Print results
    printResults();
    
    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  log(`Unhandled error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
