/**
 * Storybook MCP Server
 * 
 * This server implements the Model Context Protocol (MCP) to allow AI assistants
 * to visually analyze Storybook UI components. It provides tools for discovering
 * available components and capturing screenshots of components in different states.
 * 
 * @module index
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { captureComponent, closeBrowser } from "./screenshot.js";
import { getComponents } from "./components.js";
import { checkStorybookConnection, ensureOutputDir, formatErrorDetails } from "./utils.js";
import { ServerConfig, ComponentState, Viewport } from "./types.js";
import { startHealthServer, updateHealthConfig } from "./health.js";

/**
 * Server configuration
 * Can be overridden with environment variables:
 * - STORYBOOK_URL: URL of your Storybook instance
 * - OUTPUT_DIR: Directory for screenshot output
 * - PORT: Port for the Express server (default: 3001)
 */
const config: ServerConfig = {
  storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
  outputDir: process.env.OUTPUT_DIR || './screenshots',
  port: parseInt(process.env.PORT || '3001')
};

// Store active transports for message routing
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Main application entry point
 * Initializes the MCP server and registers available tools
 */
async function main() {
  // Start the health check server with config
  startHealthServer(3000, { storybookUrl: config.storybookUrl });

  // Initialize MCP server with metadata
  const server = new McpServer({
    name: "Storybook MCP Server",
    version: "1.0.0"
  });

  try {
    // Ensure output directory exists and Storybook is accessible
    console.log('Output directory ready:', config.outputDir);
    await ensureOutputDir(config.outputDir);
    
    console.log('Checking connection to Storybook at', config.storybookUrl);
    await checkStorybookConnection(config.storybookUrl);
    console.log('Storybook connection successful');
    
    // Register the "components" tool
    // This tool lists all available Storybook components and their variants
    server.tool(
      "components",
      {}, // No parameters needed
      async () => {
        try {
          console.log('Fetching components from Storybook...');
          const components = await getComponents(config.storybookUrl);
          console.log(`Found ${components.length} components`);
          
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
    // This tool captures screenshots of components in specific states and viewport sizes
    server.tool(
      "capture",
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
          const fullViewport: Viewport = {
            width: viewport.width ?? 1024,
            height: viewport.height ?? 768
          };

          const result = await captureComponent({
            component,
            variant,
            state: state as ComponentState,
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

    // Set up Express server for SSE
    const app = express();
    app.use(express.json());

    // SSE endpoint
    app.get("/sse", async (req, res) => {
      const sessionId = req.query.session as string || Math.random().toString(36).substring(2, 15);
      console.log(`New SSE connection established: ${sessionId}`);
      
      // Set necessary headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Create transport and store it
      const transport = new SSEServerTransport("/messages", res);
      activeTransports.set(sessionId, transport);
      
      // Clean up when client disconnects
      req.on('close', () => {
        console.log(`SSE connection closed: ${sessionId}`);
        activeTransports.delete(sessionId);
      });
      
      // Connect to MCP server
      await server.connect(transport);
    });

    // Message handling endpoint
    app.post("/messages", async (req, res) => {
      const sessionId = req.query.session as string || req.headers['x-session-id'] as string;
      if (!sessionId || !activeTransports.has(sessionId)) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      const transport = activeTransports.get(sessionId);
      await transport.handlePostMessage(req, res);
    });
    
    // Start the Express server
    app.listen(config.port, () => {
      console.log(`Storybook MCP Server running on port ${config.port}`);
      console.log(`Connected to Storybook at ${config.storybookUrl}`);
    });
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
