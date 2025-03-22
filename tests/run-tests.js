import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - use environment variables for Docker compatibility
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '../test-output');

// Create output directory if it doesn't exist
fs.ensureDirSync(OUTPUT_DIR);

// Helper function to log test results
function logTest(name, passed, message = '') {
  const status = passed ? '✅ PASSED' : '❌ FAILED';
  console.log(`${status} - ${name}${message ? ': ' + message : ''}`);
  if (!passed) {
    process.exitCode = 1;
  }
}

// Helper function to pause execution
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test: Check if MCP server is running
async function testServerRunning() {
  try {
    const response = await axios.get(`${MCP_SERVER_URL}/health`);
    logTest('Server Health Check', response.status === 200);
    return true;
  } catch (error) {
    logTest('Server Health Check', false, `Server not responding: ${error.message}`);
    return false;
  }
}

// Test: Check if Storybook is accessible
async function testStorybookRunning() {
  try {
    // First try the MCP server's Storybook URL via health check endpoint
    const healthResponse = await axios.get(`${MCP_SERVER_URL}/health`);
    if (healthResponse.data && healthResponse.data.storybookUrl) {
      console.log(`Storybook URL from health check: ${healthResponse.data.storybookUrl}`);

      // Try to access Storybook directly
      try {
        await axios.get(`http://storybook:6006`);
        logTest('Storybook Direct Access', true);
      } catch (error) {
        console.log(`Error accessing Storybook directly: ${error.message}`);
        logTest('Storybook Direct Access', false);
      }
    } else {
      console.log('No Storybook URL in health response');
    }

    return true;
  } catch (error) {
    logTest('Storybook Connection Test', false, `Failed to test Storybook: ${error.message}`);
    return false;
  }
}

// Initialize MCP client and connect to server
async function initMcpClient() {
  try {
    console.log('Initializing MCP client...');
    
    // Generate a session ID
    const sessionId = `test-session-${Date.now()}`;
    console.log(`Using session ID: ${sessionId}`);

    // Create SSE transport to connect to the MCP server
    const transport = new SSEClientTransport({
      baseUrl: MCP_SERVER_URL,
      sseEndpoint: "/sse",
      messageEndpoint: "/messages",
      sessionId: sessionId
    });
    
    // Create client
    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0"
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {}
        }
      }
    );
    
    console.log('Connecting to MCP transport...');
    await client.connect(transport);
    console.log('Connected successfully to MCP client');
    
    return { client, transport };
  } catch (error) {
    console.error('Error initializing MCP client:', error);
    throw error;
  }
}

// Test: Get components
async function testGetComponents(client) {
  try {
    console.log('Testing components endpoint...');

    // Call the components tool through MCP client
    const response = await client.callTool({
      name: "components",
      arguments: {}
    });
    console.log('Got response from components endpoint');

    if (!response || !response.content || response.content.length === 0) {
      throw new Error('No content in response');
    }

    // Parse the response content
    const contentText = response.content[0].text;
    const data = JSON.parse(contentText);

    // Log the raw response for debugging
    console.log('Response data: ', JSON.stringify(data).substring(0, 500) + '...');

    // Verify we have components and success is true
    const success = data.success === true;
    const hasComponents = data.components && data.components.length > 0;

    // Check for Button components specifically
    const hasButtonComponents = data.components && data.components.some(comp =>
        comp.id.includes('button') || comp.id.includes('Button')
    );

    logTest('Get Components', success && hasComponents,
        hasComponents ? `Found ${data.count} components` : 'No components found');

    if (hasComponents) {
      console.log('Component IDs found:');
      data.components.forEach(comp => {
        console.log(`- ${comp.id} (${comp.variants.length} variants)`);
      });
    }

    logTest('Button Components', hasButtonComponents,
        hasButtonComponents ? 'Found Button components' : 'No Button components found');

    return data.components || [];
  } catch (error) {
    console.error('Complete error object:', error);
    logTest('Get Components', false, `Failed to get components: ${error.message}`);

    return [];
  }
}

// Test: Capture component
async function testCaptureComponent(client, componentId) {
  try {
    // Capture default state
    const captureResponse = await client.callTool({
      name: "capture",
      arguments: {
        component: componentId,
        variant: 'Default'
      }
    });

    if (!captureResponse || !captureResponse.content || captureResponse.content.length === 0) {
      throw new Error('No content in response');
    }

    const data = JSON.parse(captureResponse.content[0].text);

    // Wait for screenshot to be taken
    await sleep(2000);

    // Extract the filename from the path
    const screenshotPath = data.screenshotPath;
    const filename = path.basename(screenshotPath);
    const outputPath = path.join(OUTPUT_DIR, filename);

    // Check if screenshot file exists
    const screenshotExists = await fs.pathExists(outputPath);

    // Check file size to ensure it's a valid image
    let fileSize = 0;
    if (screenshotExists) {
      const stats = await fs.stat(outputPath);
      fileSize = stats.size;
    }

    const isValidScreenshot = screenshotExists && fileSize > 1000; // At least 1KB

    logTest(`Capture Component (${componentId})`, data.success && isValidScreenshot,
        isValidScreenshot ? `Screenshot created (${fileSize} bytes)` : 'Screenshot not created or invalid');

    return data.success && isValidScreenshot;
  } catch (error) {
    logTest(`Capture Component (${componentId})`, false, `Failed to capture component: ${error.message}`);
    return false;
  }
}

// Test: Capture component in hover state
async function testCaptureComponentHover(client, componentId) {
  try {
    // Capture hover state
    const hoverResponse = await client.callTool({
      name: "capture",
      arguments: {
        component: componentId,
        variant: 'Default',
        state: { hover: true }
      }
    });

    if (!hoverResponse || !hoverResponse.content || hoverResponse.content.length === 0) {
      throw new Error('No content in response');
    }

    const data = JSON.parse(hoverResponse.content[0].text);

    // Wait for screenshot to be taken
    await sleep(2000);

    // Extract the filename from the path
    const screenshotPath = data.screenshotPath;
    const filename = path.basename(screenshotPath);
    const outputPath = path.join(OUTPUT_DIR, filename);

    // Check if screenshot file exists
    const screenshotExists = await fs.pathExists(outputPath);

    logTest(`Capture Component Hover (${componentId})`, data.success && screenshotExists,
        screenshotExists ? 'Hover state captured' : 'Failed to capture hover state');

    return data.success && screenshotExists;
  } catch (error) {
    logTest(`Capture Component Hover (${componentId})`, false, `Failed to capture hover state: ${error.message}`);
    return false;
  }
}

// Test: Capture component at mobile viewport
async function testCaptureResponsive(client, componentId) {
  try {
    // Capture mobile viewport
    const mobileResponse = await client.callTool({
      name: "capture",
      arguments: {
        component: componentId,
        variant: 'Default',
        viewport: { width: 375, height: 667 }
      }
    });

    if (!mobileResponse || !mobileResponse.content || mobileResponse.content.length === 0) {
      throw new Error('No content in response');
    }

    const data = JSON.parse(mobileResponse.content[0].text);

    // Wait for screenshot to be taken
    await sleep(2000);

    // Extract the filename from the path
    const screenshotPath = data.screenshotPath;
    const filename = path.basename(screenshotPath);
    const outputPath = path.join(OUTPUT_DIR, filename);

    // Check if screenshot file exists
    const screenshotExists = await fs.pathExists(outputPath);

    logTest(`Capture Responsive (${componentId})`, data.success && screenshotExists,
        screenshotExists ? 'Mobile viewport captured' : 'Failed to capture mobile viewport');

    return data.success && screenshotExists;
  } catch (error) {
    logTest(`Capture Responsive (${componentId})`, false, `Failed to capture responsive: ${error.message}`);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting integration tests...');

  // Wait for the server to be ready
  let serverReady = false;
  for (let i = 0; i < 10; i++) {
    console.log(`Checking if server is ready (attempt ${i + 1}/10)...`);
    serverReady = await testServerRunning();
    if (serverReady) break;
    await sleep(3000);
  }

  if (!serverReady) {
    console.log('Server not ready after multiple attempts. Aborting tests.');
    process.exit(1);
  }

  // Check if Storybook is accessible
  await testStorybookRunning();

  // Initialize MCP client
  let client, transport;
  try {
    ({ client, transport } = await initMcpClient());
  } catch (error) {
    console.error('Failed to initialize MCP client:', error);
    process.exit(1);
  }

  try {
    // Get components
    const components = await testGetComponents(client);

    if (!components || components.length === 0) {
      console.log('No components found. Aborting tests.');
      process.exit(1);
    }

    // Select a button component for testing
    const buttonComponent = components.find(comp =>
        comp.id.includes('button--primary') ||
        comp.id.includes('button') ||
        comp.id.includes('Button')
    );

    if (!buttonComponent) {
      console.log('No button component found. Aborting tests.');
      process.exit(1);
    }

    console.log(`Using component: ${buttonComponent.id}`);

    // Run capture tests
    const captureTests = [
      await testCaptureComponent(client, buttonComponent.id),
      await testCaptureComponentHover(client, buttonComponent.id),
      await testCaptureResponsive(client, buttonComponent.id)
    ];

    // Check if all capture tests passed
    const allCaptureTestsPassed = captureTests.every(result => result);

    // Check the output directory for screenshots
    const files = await fs.readdir(OUTPUT_DIR);
    const screenshotFiles = files.filter(file => file.endsWith('.png'));

    logTest('Screenshot Count', screenshotFiles.length >= 3,
        `Found ${screenshotFiles.length} screenshots`);

    // List all screenshots
    console.log('\nScreenshots generated:');
    for (const file of screenshotFiles) {
      console.log(`- ${file}`);
    }

    console.log('\nIntegration tests completed.');

    // Set exit code based on test results
    if (!allCaptureTestsPassed || screenshotFiles.length < 3) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Error during tests:', error);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});