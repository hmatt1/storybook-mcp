/**
 * Storybook MCP Server
 * 
 * This server implements the Model Context Protocol (MCP) to allow AI assistants
 * to visually analyze Storybook UI components. It provides tools for discovering
 * available components and capturing screenshots of components in different states.
 * 
 * @module index
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureComponent, closeBrowser } from "./screenshot.js";
import { getComponents } from "./components.js";
import { checkStorybookConnection, ensureOutputDir, formatErrorDetails } from "./utils.js";
import { ServerConfig, ComponentState } from "./types.js";

/**
 * Server configuration
 * Can be overridden with environment variables:
 * - STORYBOOK_URL: URL of your Storybook instance
 * - OUTPUT_DIR: Directory for screenshot output
 */
const config: ServerConfig = {
  storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
  outputDir: process.env.OUTPUT_DIR || './screenshots'
};

/**
 * Main application entry point
 * Initializes the MCP server and registers available tools
 */
async function main() {
  // Initialize MCP server with metadata
  const server = new McpServer({
    name: "Storybook MCP Server",
    version: "1.0.0"
  });

  try {
    // Ensure output directory exists and Storybook is accessible
    await ensureOutputDir(config.outputDir);
    await checkStorybookConnection(config.storybookUrl);
    
    // Register the "components" tool
    // This tool lists all available Storybook components and their variants
    server.tool(
      "components",
      {}, // No parameters needed
      async () => {
        try {
          const components = await getComponents(config.storybookUrl);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  count: components.length,
                  components
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          const errorMessage = formatErrorDetails(error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: 'Failed to retrieve components',
                  details: errorMessage
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }
    );

    // Register the "capture" tool
    // This tool captures screenshots of components in specific states and viewport sizes
    server.tool(
      "capture",
      {
        component: z.string().describe("Component ID to capture"),
        variant: z.string().optional().describe("Variant name (default: 'Default')"),
        state: z.enum(["default", "hover", "focus", "active"]).optional().describe("Component state"),
        width: z.number().optional().describe("Viewport width in pixels"),
        height: z.number().optional().describe("Viewport height in pixels")
      },
      async ({ component, variant = "Default", state = "default", width = 1024, height = 768 }) => {
        try {
          const result = await captureComponent({
            component,
            variant,
            state: state as ComponentState,
            viewport: { width, height },
            storybookUrl: config.storybookUrl,
            outputDir: config.outputDir
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  ...result
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          const errorMessage = formatErrorDetails(error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: 'Failed to capture component',
                  details: errorMessage
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      }
    );

    // Connect to the transport layer
    // The StdioServerTransport uses standard input/output for communication
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.log("Storybook MCP Server running");
    console.log(`Connected to Storybook at ${config.storybookUrl}`);
  } catch (error) {
    console.error('Failed to initialize server:', formatErrorDetails(error));
    process.exit(1);
  }
}

// Register process event handlers for clean shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  closeBrowser().then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  closeBrowser().then(() => {
    process.exit(0);
  });
});

// Start the application
main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
