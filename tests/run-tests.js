#!/usr/bin/env node

/**
 * Simple test script for the Storybook MCP Server
 * This tests the server in isolation using child_process to communicate via stdio
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';

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
}

// Spawn the server process
console.log('Spawning server process...');
const serverProcess = spawn('node', [serverPath], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin/stdout, inherit stderr
});

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

// Set up a handler for the server's stdout
serverProcess.stdout.on('data', (data) => {
  try {
    const response = data.toString().trim();
    console.log(`Server response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);
    
    const parsedResponse = JSON.parse(response);
    
    // If we got the initialize response, send the initialized notification
    if (parsedResponse.id === 1 && parsedResponse.result) {
      console.log('Server initialized, sending initialized notification...');
      
      const initializedNotification = {
        jsonrpc: '2.0',
        method: 'initialized',
        params: {}
      };
      
      serverProcess.stdin.write(JSON.stringify(initializedNotification) + '\n');
      
      // Now request the list of tools
      const listToolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };
      
      console.log('Sending tools/list request...');
      serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    }
    
    // If we got the tools list, call the components tool
    if (parsedResponse.id === 2 && parsedResponse.result && parsedResponse.result.tools) {
      console.log(`Got tools list with ${parsedResponse.result.tools.length} tools, calling components tool...`);
      
      const callToolRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'components',
          arguments: {}
        }
      };
      
      console.log('Sending tool/call request for components...');
      serverProcess.stdin.write(JSON.stringify(callToolRequest) + '\n');
    }
    
    // If we got the components tool response, test is successful
    if (parsedResponse.id === 3 && parsedResponse.result) {
      console.log('Got components tool response, test successful!');
      testCompleted = true;
      
      // Clean up and exit
      serverProcess.stdin.end();
      setTimeout(() => {
        serverProcess.kill();
        process.exit(0);
      }, 1000);
    }
  } catch (err) {
    console.error('Error parsing server response:', err);
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
setTimeout(() => {
  if (!testCompleted) {
    console.error('Test timed out after 60 seconds');
    serverProcess.kill();
    process.exit(1);
  }
}, 60000);