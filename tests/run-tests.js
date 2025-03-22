#!/usr/bin/env node

/**
 * Fully dynamic test script for the Storybook MCP Server
 * 
 * This script:
 * 1. Discovers all components and variants dynamically
 * 2. Takes screenshots of each variant in multiple states
 * 3. Asserts that all screenshots were captured successfully
 * 4. Provides a comprehensive test report
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';
import * as path from 'path';

// Get the directory of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

console.log('Starting Storybook MCP Server test...');
console.log(`Server path: ${serverPath}`);

// Set environment variables for the test
const env = {
  ...process.env,
  STORYBOOK_URL: process.env.TEST_STORYBOOK_URL || 'http://localhost:6006',
  OUTPUT_DIR: process.env.TEST_OUTPUT_DIR || './test-output',
  DEBUG: 'true'
};

// Create output directory if it doesn't exist
const outputDir = env.OUTPUT_DIR;
if (!fs.existsSync(outputDir)) {
  console.log(`Creating output directory: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
} else {
  // Clean up previous test output
  console.log('Cleaning previous test output...');
  fs.readdirSync(outputDir)
    .filter(file => file.endsWith('.png'))
    .forEach(file => fs.unlinkSync(join(outputDir, file)));
}

// Track the currently executing test
let currentTest = 'initialize';

// Test queue management
let componentsMap = {}; // Map of component ID to component details
let componentIds = []; // List of component IDs
let currentComponentIndex = 0;
let currentVariantIndex = 0;
let currentStateIndex = 0;
let screenshotsTaken = 0;
let expectedScreenshots = 0;
let failedScreenshots = 0;
let screenshotResults = [];

// Define component states to test
const statesToTest = [
  { name: 'default', config: { hover: false, focus: false, active: false } },
  { name: 'hover', config: { hover: true, focus: false, active: false } },
  { name: 'focus', config: { hover: false, focus: true, active: false } }
];

// Spawn the server process
console.log('Spawning server process...');
const serverProcess = spawn('node', [serverPath], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin/stdout, inherit stderr
});

// Handle process cleanup gracefully
function cleanupAndExit(exitCode) {
  console.log(`Exiting with code ${exitCode}...`);
  
  try {
    // Make sure we try to close properly to avoid hanging
    serverProcess.stdin.end();
    setTimeout(() => {
      try {
        serverProcess.kill();
      } catch (e) {
        // Ignore errors when killing process
      }
      process.exit(exitCode);
    }, 1000);
  } catch (e) {
    // Force exit if normal exit fails
    console.error('Error during cleanup, forcing exit:', e);
    process.exit(exitCode);
  }
}

// Set up a timeout to wait for server to be ready
console.log('Waiting for server to initialize...');
await new Promise(resolve => setTimeout(resolve, 5000));

// Test the components tool
console.log('Testing MCP protocol interaction...');
const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '0.1.0',
    clientInfo: {
      name: 'mcp-test-client',
      version: '1.0.0'
    },
    capabilities: {
      resources: {},
      tools: {}
    }
  }
};

console.log('Sending initialize request...');
// Write the request to the server's stdin
serverProcess.stdin.write(JSON.stringify(initializeRequest) + '\n');

// Keep track of whether the test has completed
let testCompleted = false;
let nextRequestId = 1;

/**
 * Send JSON-RPC request to the server
 */
function sendRequest(method, params = {}) {
  const id = nextRequestId++;
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
  
  console.log(`Sending ${method} request (id: ${id})...`);
  serverProcess.stdin.write(JSON.stringify(request) + '\n');
  return id;
}

/**
 * Process the next component/variant/state in the queue
 */
function processNextScreenshot() {
  // Check if we've completed all screenshots
  if (currentComponentIndex >= componentIds.length) {
    console.log(`✅ Screenshot testing completed: ${screenshotsTaken}/${expectedScreenshots} screenshots taken`);
    
    // Complete test and generate report directly
    const testPassed = generateTestReport();
    
    testCompleted = true;
    cleanupAndExit(testPassed ? 0 : 1);
    return;
  }
  
  const componentId = componentIds[currentComponentIndex];
  const component = componentsMap[componentId];
  
  // Check if we've completed all variants for this component
  if (currentVariantIndex >= component.variants.length) {
    // Move to the next component
    currentComponentIndex++;
    currentVariantIndex = 0;
    currentStateIndex = 0;
    processNextScreenshot();
    return;
  }
  
  const variant = component.variants[currentVariantIndex];
  
  // Check if we've completed all states for this variant
  if (currentStateIndex >= statesToTest.length) {
    // Move to the next variant
    currentVariantIndex++;
    currentStateIndex = 0;
    processNextScreenshot();
    return;
  }
  
  const state = statesToTest[currentStateIndex];
  const stateConfig = state.config;
  
  // Log the current screenshot being taken
  console.log(`📸 Taking screenshot for ${component.name} > ${variant.name} > ${state.name} state`);
  
  // Expected screenshot path
  const expectedFilename = `${componentId.replace(/\//g, '-')}--${variant.name.toLowerCase().replace(/\s+/g, '-')}-${state.name}.png`;
  const expectedPath = path.join(outputDir, expectedFilename);
  
  // Capture screenshot for this component/variant/state
  const captureId = sendRequest('tools/call', {
    name: 'capture',
    arguments: {
      component: componentId,
      variant: variant.name,
      state: stateConfig,
      viewport: {
        width: 800,
        height: 600
      }
    }
  });
  
  currentTest = 'capture-screenshot';
}

/**
 * Calculate the expected number of screenshots
 */
function calculateExpectedScreenshots() {
  let total = 0;
  Object.values(componentsMap).forEach(component => {
    total += component.variants.length * statesToTest.length;
  });
  return total;
}

/**
 * Generate a test report
 */
function generateTestReport() {
  // Calculate success rate
  const successRate = expectedScreenshots > 0 
    ? (screenshotsTaken / expectedScreenshots) * 100
    : 0;
  
  console.log(`
===========================================================
                     TEST SUMMARY
===========================================================
Components tested: ${componentIds.length}
Total variants: ${Object.values(componentsMap).reduce((sum, comp) => sum + comp.variants.length, 0)}
Expected screenshots: ${expectedScreenshots}
Successful screenshots: ${screenshotsTaken} (${successRate.toFixed(2)}%)
Failed screenshots: ${failedScreenshots}
===========================================================
`);

  // Results by component
  console.log('RESULTS BY COMPONENT:');
  Object.values(componentsMap).forEach(component => {
    const componentResults = screenshotResults.filter(r => r.component === component.id);
    const successCount = componentResults.filter(r => r.success).length;
    const failCount = componentResults.filter(r => !r.success).length;
    const totalCount = successCount + failCount;
    const componentSuccessRate = totalCount > 0 
      ? (successCount / totalCount) * 100
      : 0;
    
    console.log(`- ${component.name}: ${successCount}/${totalCount} (${componentSuccessRate.toFixed(2)}%)`);
    
    // Log failures for this component if any
    if (failCount > 0) {
      const failures = componentResults.filter(r => !r.success);
      failures.forEach(f => {
        console.log(`  ❌ Failed: ${f.variant} (${f.state}) - ${f.error}`);
      });
    }
  });
  
  // Assert result - consider test successful if all expected screenshots were taken
  const testPassed = failedScreenshots === 0 && screenshotsTaken === expectedScreenshots;
  console.log(`
===========================================================
                    TEST RESULT: ${testPassed ? '✅ PASSED' : '❌ FAILED'}
===========================================================
`);
  
  return testPassed;
}

// Set up a handler for the server's stdout
serverProcess.stdout.on('data', (data) => {
  try {
    const response = data.toString().trim();
    console.log(`Server response for ${currentTest} (truncated): ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);
    
    const parsedResponse = JSON.parse(response);
    const responseId = parsedResponse.id;
    
    // Handle error responses
    if (parsedResponse.error) {
      console.error(`Error response for request ${responseId}: ${parsedResponse.error.message}`);
      
      // For screenshot errors, track the failure but continue
      if (currentTest === 'capture-screenshot') {
        failedScreenshots++;
        
        // Add failed result
        if (currentComponentIndex < componentIds.length) {
          const componentId = componentIds[currentComponentIndex];
          const component = componentsMap[componentId];
          
          if (currentVariantIndex < component.variants.length) {
            const variant = component.variants[currentVariantIndex];
            const state = statesToTest[currentStateIndex];
            
            screenshotResults.push({
              component: componentId,
              componentName: component.name,
              variant: variant.name,
              state: state.name,
              success: false,
              path: null,
              error: `Error response: ${parsedResponse.error.message}`
            });
          }
        }
        
        console.log('Continuing with next test...');
        currentStateIndex++;
        processNextScreenshot();
        return;
      } else {
        // For other errors, log the error but continue
        console.error('Continuing despite error response');
      }
    }
    
    // State machine for test phases
    switch (currentTest) {
      case 'initialize':
        if (responseId === 1 && parsedResponse.result) {
          console.log('Server initialized, sending initialized notification...');
          
          const initializedNotification = {
            jsonrpc: '2.0',
            method: 'initialized',
            params: {}
          };
          
          serverProcess.stdin.write(JSON.stringify(initializedNotification) + '\n');
          
          // Request the list of tools
          const toolsId = sendRequest('tools/list');
          currentTest = 'list-tools';
        }
        break;
        
      case 'list-tools':
        if (parsedResponse.result && parsedResponse.result.tools) {
          const tools = parsedResponse.result.tools;
          console.log(`Got tools list with ${tools.length} tools`);
          
          // Verify both required tools are present
          const hasComponentsTool = tools.some(t => t.name === 'components');
          const hasCaptureTool = tools.some(t => t.name === 'capture');
          
          if (!hasComponentsTool || !hasCaptureTool) {
            console.error(`Missing required tools: ${!hasComponentsTool ? 'components ' : ''}${!hasCaptureTool ? 'capture' : ''}`);
            testCompleted = true;
            cleanupAndExit(1);
            return;
          }
          
          // Test components tool
          const componentsId = sendRequest('tools/call', {
            name: 'components',
            arguments: {}
          });
          currentTest = 'components-tool';
        }
        break;
        
      case 'components-tool':
        if (parsedResponse.result) {
          console.log('Got components tool response');
          
          // Check if successful and contains components
          try {
            const responseText = parsedResponse.result.content[0].text;
            const componentsData = JSON.parse(responseText);
            
            if (componentsData.success && componentsData.components && componentsData.components.length > 0) {
              console.log(`Found ${componentsData.count} components`);
              
              // Build component map for easier lookup
              componentsData.components.forEach(comp => {
                componentsMap[comp.id] = comp;
              });
              
              // Store component IDs for iteration
              componentIds = Object.keys(componentsMap);
              
              // Log all found components and variants
              Object.values(componentsMap).forEach(comp => {
                console.log(`- Component: ${comp.name} (${comp.variants.length} variants)`);
                comp.variants.forEach(v => {
                  console.log(`  - Variant: ${v.name}`);
                });
              });
              
              // Calculate expected screenshots
              expectedScreenshots = calculateExpectedScreenshots();
              console.log(`Will take ${expectedScreenshots} screenshots (${componentIds.length} components x variants x ${statesToTest.length} states)`);
              
              // Start the screenshot process with the first component
              processNextScreenshot();
            } else {
              console.error('No components found in response');
              testCompleted = true;
              cleanupAndExit(1);
            }
          } catch (err) {
            console.error('Error parsing components response:', err);
            testCompleted = true;
            cleanupAndExit(1);
          }
        }
        break;
        
      case 'capture-screenshot':
        if (parsedResponse.result) {
          try {
            const responseText = parsedResponse.result.content[0].text;
            const captureData = JSON.parse(responseText);
            
            const componentId = componentIds[currentComponentIndex];
            const component = componentsMap[componentId];
            const variant = component.variants[currentVariantIndex];
            const state = statesToTest[currentStateIndex];
            
            const screenshotResult = {
              component: componentId,
              componentName: component.name,
              variant: variant.name,
              state: state.name,
              success: false,
              path: null,
              error: null
            };
            
            if (captureData.success) {
              // Verify screenshot file exists
              if (fs.existsSync(captureData.screenshotPath)) {
                // Screenshot successful
                screenshotsTaken++;
                screenshotResult.success = true;
                screenshotResult.path = captureData.screenshotPath;
                console.log(`✅ Screenshot saved: ${captureData.screenshotPath}`);
              } else {
                // Screenshot file missing
                failedScreenshots++;
                screenshotResult.error = `File not found: ${captureData.screenshotPath}`;
                console.error(`Screenshot file not found: ${captureData.screenshotPath}`);
              }
            } else {
              // Screenshot capture failed
              failedScreenshots++;
              screenshotResult.error = captureData.error || 'Unknown error';
              console.error('Screenshot capture failed:', captureData.error);
            }
            
            // Add to results collection
            screenshotResults.push(screenshotResult);
            
            // Move to the next state
            currentStateIndex++;
            processNextScreenshot();
          } catch (err) {
            // Error parsing response
            failedScreenshots++;
            const componentId = componentIds[currentComponentIndex];
            const component = componentsMap[componentId];
            const variant = component.variants[currentVariantIndex];
            const state = statesToTest[currentStateIndex];
            
            screenshotResults.push({
              component: componentId,
              componentName: component.name,
              variant: variant.name,
              state: state.name,
              success: false,
              path: null,
              error: `Error parsing response: ${err.message}`
            });
            
            console.error('Error parsing capture response:', err);
            currentStateIndex++;
            processNextScreenshot();
          }
        }
        break;
    }
  } catch (err) {
    console.error('Error parsing server response:', err);
    // Don't abort the entire test for parsing errors
    if (currentTest === 'capture-screenshot') {
      failedScreenshots++;
      
      // Add failed result
      if (currentComponentIndex < componentIds.length) {
        const componentId = componentIds[currentComponentIndex];
        const component = componentsMap[componentId];
        
        if (currentVariantIndex < component.variants.length) {
          const variant = component.variants[currentVariantIndex];
          const state = statesToTest[currentStateIndex];
          
          screenshotResults.push({
            component: componentId,
            componentName: component.name,
            variant: variant.name,
            state: state.name,
            success: false,
            path: null,
            error: `Error parsing response: ${err.message}`
          });
        }
      }
      
      console.log('Continuing with next test...');
      currentStateIndex++;
      processNextScreenshot();
    } else {
      testCompleted = true;
      cleanupAndExit(1);
    }
  }
});

// Handle errors
serverProcess.on('error', (err) => {
  console.error('Failed to start server process:', err);
  process.exit(1);
});

// Handle server process exit
serverProcess.on('exit', (code, signal) => {
  if (!testCompleted) {
    console.error(`Server process exited unexpectedly with code ${code} and signal ${signal}`);
    process.exit(code || 1);
  }
});

// Set a timeout for the entire test
const timeoutMinutes = 5;
setTimeout(() => {
  if (!testCompleted) {
    console.error(`Test timed out after ${timeoutMinutes} minutes`);
    
    // Generate partial report if possible
    if (screenshotResults.length > 0) {
      console.log('Generating partial test report before timeout...');
      generateTestReport();
    }
    
    cleanupAndExit(1);
  }
}, timeoutMinutes * 60 * 1000);

console.log(`Test timeout set to ${timeoutMinutes} minutes`);
