/**
 * Storybook MCP Server
 *
 * This server implements the Model Context Protocol (MCP) to allow AI assistants
 * to visually analyze Storybook UI components.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureComponent, closeBrowser } from "./screenshot.js";
import { getComponents } from "./components.js";
import { checkStorybookConnection, ensureOutputDir, formatErrorDetails } from "./utils.js";
import { ServerConfig } from "./types.js";

/**
 * Redirect console.log to stderr to avoid interfering with JSONRPC communication
 * This preserves the original console.log function
 */
const originalConsoleLog = console.log;
console.log = (...args) => {
  console.error(...args);
};

/**
 * Server configuration
 * Can be overridden with environment variables:
 * - STORYBOOK_URL: URL of your Storybook instance
 * - OUTPUT_DIR: Directory for screenshot output
 * - DEBUG: Enable debug mode (default: false)
 */
const config: ServerConfig = {
  storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
  outputDir: process.env.OUTPUT_DIR || './screenshots',
  debug: process.env.DEBUG === 'true' || false
};

// Debug logging function that respects the debug flag
function debugLog(...args: any[]): void {
  if (config.debug) {
    console.error('[DEBUG]', ...args);
  }
}

// Create MCP server - using McpServer instead of Server
const server = new McpServer({
  name: "Storybook MCP Server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

/**
 * Main application entry point
 * Initializes the MCP server and registers available tools
 */
async function main() {
  try {
    // Ensure output directory exists and Storybook is accessible
    await ensureOutputDir(config.outputDir);
    console.error('Output directory ready:', config.outputDir);

    await checkStorybookConnection(config.storybookUrl);
    console.error('Storybook connection successful at', config.storybookUrl);

    // Register a resource to get the list of components
    server.resource(
        "components-list",
        "components://storybook",
        async (uri) => {
          try {
            debugLog('Fetching components for resource...');
            const components = await getComponents(config.storybookUrl);

            return {
              contents: [{
                uri: uri.href,
                text: JSON.stringify({
                  count: components.length,
                  components: components
                }, null, 2)
              }]
            };
          } catch (error) {
            console.error('Error fetching components for resource:', error);
            return {
              contents: [{
                uri: uri.href,
                text: JSON.stringify({
                  error: 'Failed to retrieve components',
                  details: formatErrorDetails(error)
                }, null, 2)
              }]
            };
          }
        }
    );

    // Register the "components" tool
    server.tool(
        "components",
        "Get a list of all components in the Storybook instance",
        {}, // No parameters needed
        async () => {
          try {
            debugLog('Fetching components from Storybook...');
            const components = await getComponents(config.storybookUrl);
            debugLog(`Found ${components.length} components`);

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
            console.error('Error fetching components:', errorMessage);
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
    server.tool(
        "capture",
        "Capture a screenshot of a Storybook component",
        {
          component: z.string().describe("Component ID to capture"),
          variant: z.string().optional().describe("Variant name (default: 'Default')"),
          state: z.object({
            hover: z.boolean().optional(),
            focus: z.boolean().optional(),
            active: z.boolean().optional()
          }).optional().describe("Component state"),
          viewport: z.object({
            width: z.number().optional(),
            height: z.number().optional()
          }).optional().describe("Viewport dimensions")
        },
        async ({ component, variant = "Default", state = {}, viewport = { width: 1024, height: 768 } }) => {
          try {
            // Ensure viewport has required properties with default values
            const fullViewport = {
              width: viewport.width ?? 1024,
              height: viewport.height ?? 768
            };

            const result = await captureComponent({
              component,
              variant,
              state,
              viewport: fullViewport,
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
            console.error('Error capturing component:', errorMessage);

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

    // Create and connect the transport
    const transport = new StdioServerTransport();

    // Connect the server to the transport
    await server.connect(transport);

    console.error('Storybook MCP Server running with STDIO transport');
    console.error(`Connected to Storybook at ${config.storybookUrl}`);

    // Keep the process running indefinitely
    // This creates a promise that never resolves to keep the Node.js event loop active
    await new Promise(() => {
      console.error('Server running indefinitely... (press Ctrl+C to stop)');
      // This promise intentionally never resolves
    });

  } catch (error) {
    console.error('Failed to initialize server:', formatErrorDetails(error));
    process.exit(1);
  }
}

// Register process event handlers for clean shutdown
process.on('SIGINT', () => {
  console.error('Shutting down server...');
  closeBrowser().then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.error('Shutting down server...');
  closeBrowser().then(() => {
    process.exit(0);
  });
});

// Add handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application continues running despite unhandled promise rejections
});

// Start the application
main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});