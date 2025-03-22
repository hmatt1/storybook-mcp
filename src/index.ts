/**
 * Storybook MCP Server
 * 
 * This server implements the Model Context Protocol (MCP) to allow AI assistants
 * to visually analyze Storybook UI components.
 */

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { captureComponent, closeBrowser } from "./screenshot.js";
import { getComponents } from "./components.js";
import { checkStorybookConnection, ensureOutputDir, formatErrorDetails } from "./utils.js";
import { ServerConfig } from "./types.js";

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

// Create MCP server
const server = new McpServer({
  name: "Storybook MCP Server",
  version: "1.0.0"
});

// Create Express app
const app = express();
app.use(express.json());

// Store active transports for message routing
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Main application entry point
 * Initializes the MCP server and registers available tools
 */
async function main() {
  try {
    // Ensure output directory exists and Storybook is accessible
    await ensureOutputDir(config.outputDir);
    console.log('Output directory ready:', config.outputDir);

    await checkStorybookConnection(config.storybookUrl);
    console.log('Storybook connection successful at', config.storybookUrl);

    // Register a resource to get the list of components
    server.resource(
      "components-list",
      "components://storybook",
      async (uri) => {
        try {
          console.log('Fetching components for resource...');
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

    // Define route handlers explicitly
    const handleSseRequest = (req: Request, res: Response) => {
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
      server.connect(transport).catch(error => {
        console.error('Error connecting to MCP server:', formatErrorDetails(error));
      });
    };

    const handleMessageRequest = (req: Request, res: Response) : void => {
      const sessionId = req.query.session as string || req.headers['x-session-id'] as string;
      if (!sessionId || !activeTransports.has(sessionId)) {
         res.status(404).json({ error: "Session not found" });
      }

      const transport = activeTransports.get(sessionId);
      if (!transport) {
         res.status(500).json({ error: "Transport not available" });
      }

      transport.handlePostMessage(req, res).catch(error => {
        console.error('Error handling post message:', formatErrorDetails(error));
        res.status(500).json({ error: "Failed to process message" });
      });
    };

    // Set up routes
    app.get('/sse', handleSseRequest);
    app.post('/messages', handleMessageRequest);
    
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
