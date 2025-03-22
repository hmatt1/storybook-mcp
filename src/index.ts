// file: src/index.ts
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
 * Enhanced debug logging with timestamps and categories
 * This makes it easier to track the flow of events in the server
 */
function createLogger(enabled = false) {
  return {
    debug: (...args: any[]): void => {
      if (enabled) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [DEBUG]`, ...args);
      }
    },
    info: (...args: any[]): void => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [INFO]`, ...args);
    },
    warn: (...args: any[]): void => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [WARN]`, ...args);
    },
    error: (...args: any[]): void => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [ERROR]`, ...args);
    }
  };
}

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
 * - CONNECTION_RETRIES: Number of connection retries (default: 3)
 * - RETRY_DELAY: Delay between retries in ms (default: 5000)
 * - FAIL_ON_NO_STORYBOOK: Whether to fail startup if Storybook can't be reached (default: false)
 */
const config: ServerConfig = {
  storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
  outputDir: process.env.OUTPUT_DIR || './screenshots',
  debug: process.env.DEBUG === 'true' || false,
  connectionRetries: parseInt(process.env.CONNECTION_RETRIES || '3', 10),
  retryDelay: parseInt(process.env.RETRY_DELAY || '5000', 10),
  failOnNoStorybook: process.env.FAIL_ON_NO_STORYBOOK === 'true' || false
};

// Create logger with appropriate debug level
const logger = createLogger(config.debug);

// Track server state for proper cleanup
let serverState = {
  isRunning: false,
  isShuttingDown: false,
  activeRequests: 0,
  storybookConnected: false
};

// Create MCP server with all configuration
const server = new McpServer({
  name: "Storybook MCP Server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {
      listChanged: true, // Support tool list change notifications
    },
    resources: {
      listChanged: true, // Support resource list change notifications
    },
    logging: {} // Enable logging support
  }
});

/**
 * Checks if Storybook is accessible with retries
 * Returns whether connection was successful, and doesn't throw on failure
 *
 * @param {string} url - Storybook URL to check
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<boolean>} Whether connection was successful
 */
async function checkStorybookConnectionWithRetry(
    url: string,
    maxRetries = config.connectionRetries,
    delay = config.retryDelay
): Promise<boolean> {
  logger.info(`Checking Storybook connection at ${url} with ${maxRetries} max retries`);

  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      await checkStorybookConnection(url);
      logger.info(`Storybook connection successful at ${url} after ${attempts + 1} attempt(s)`);
      return true;
    } catch (error) {
      attempts++;

      logger.warn(`Connection attempt ${attempts}/${maxRetries} failed: ${formatErrorDetails(error)}`);

      if (attempts >= maxRetries) {
        break;
      }

      // Use exponential backoff with a maximum delay
      const backoffDelay = Math.min(delay * Math.pow(1.5, attempts - 1), 30000);
      logger.info(`Retrying in ${Math.round(backoffDelay/1000)} seconds...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }

  logger.error(`Failed to connect to Storybook after ${maxRetries} attempts`);
  return false;
}

/**
 * Periodically check if Storybook is available
 * This keeps trying to connect if Storybook becomes available later
 */
let storybookConnectionChecker: NodeJS.Timeout | null = null;

function startConnectionChecker(intervalMs = 60000): void {
  if (!serverState.storybookConnected) {
    storybookConnectionChecker = setInterval(async () => {
      if (!serverState.storybookConnected) {
        logger.info("Checking if Storybook is now available...");
        try {
          await checkStorybookConnection(config.storybookUrl);
          serverState.storybookConnected = true;
          logger.info("Storybook is now connected!");

          // Send log message to client
          console.error({
            level: "info",
            data: `Storybook connection established at ${config.storybookUrl}`,
          });

          // Clear interval since we're now connected
          if (storybookConnectionChecker) {
            clearInterval(storybookConnectionChecker);
            storybookConnectionChecker = null;
          }
        } catch (error) {
          // Just log and continue checking
          logger.debug(`Storybook still unavailable: ${formatErrorDetails(error)}`);
        }
      }
    }, intervalMs);
  }
}

function stopConnectionChecker(): void {
  if (storybookConnectionChecker) {
    clearInterval(storybookConnectionChecker);
    storybookConnectionChecker = null;
  }
}

/**
 * Track memory usage periodically
 * This helps identify memory leaks or issues before they cause server crashes
 */
let memoryMonitorInterval: NodeJS.Timeout | null = null;

function startMemoryMonitor(intervalMs = 60000): void {
  if (config.debug) {
    memoryMonitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      logger.debug('Memory usage:', {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
      });
    }, intervalMs);
  }
}

function stopMemoryMonitor(): void {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
  }
}

/**
 * Clean up resources gracefully when shutting down
 */
async function gracefulShutdown(exitCode = 0): Promise<void> {
  if (serverState.isShuttingDown) {
    logger.info('Shutdown already in progress, ignoring duplicate request');
    return;
  }

  serverState.isShuttingDown = true;
  logger.info(`Initiating graceful shutdown with exit code ${exitCode}`);

  // Stop monitoring
  stopMemoryMonitor();
  stopConnectionChecker();

  // Wait for active requests to complete (with a timeout)
  if (serverState.activeRequests > 0) {
    logger.info(`Waiting for ${serverState.activeRequests} active requests to complete`);

    // Wait max 5 seconds for requests to complete
    await Promise.race([
      new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (serverState.activeRequests === 0) {
            clearInterval(checkInterval);
            resolve(null);
          }
        }, 100);
      }),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  }

  try {
    logger.info('Closing browser resources');
    await closeBrowser();
  } catch (error) {
    logger.error('Error closing browser:', formatErrorDetails(error));
  }

  logger.info('Shutdown complete, exiting process');
  process.exit(exitCode);
}

/**
 * Setup the server by registering all resources and tools
 */
function setupServer() {
  // Register a resource to get the list of components
  server.resource(
      "components-list",
      "components://storybook",
      async (uri) => {
        try {
          serverState.activeRequests++;
          logger.debug('Fetching components for resource...');

          // Check if Storybook is connected
          if (!serverState.storybookConnected) {
            return {
              contents: [{
                uri: uri.href,
                text: JSON.stringify({
                  error: 'Storybook is not connected',
                  count: 0,
                  components: []
                }, null, 2)
              }]
            };
          }

          const components = await getComponents(config.storybookUrl);
          logger.debug(`Found ${components.length} components for resource`);

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
          logger.error('Error fetching components for resource:', formatErrorDetails(error));
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                error: 'Failed to retrieve components',
                details: formatErrorDetails(error),
                components: []
              }, null, 2)
            }]
          };
        } finally {
          serverState.activeRequests--;
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
          serverState.activeRequests++;
          logger.debug('Fetching components from Storybook...');

          // Check if Storybook is connected
          if (!serverState.storybookConnected) {
            console.error({
              level: "warn",
              data: "Storybook is not connected, returning empty component list",
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: 'Storybook is not connected',
                    count: 0,
                    components: []
                  }, null, 2)
                }
              ]
            };
          }

          const components = await getComponents(config.storybookUrl);
          logger.debug(`Found ${components.length} components`);

          // Send a log message that will show up in the client
          console.error({
            level: "info",
            data: `Successfully found ${components.length} components in Storybook`,
          });

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
          logger.error('Error fetching components:', errorMessage);

          // Send error log to client
          console.error({
            level: "error",
            data: `Failed to get components: ${errorMessage}`,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: 'Failed to retrieve components',
                  details: errorMessage,
                  count: 0,
                  components: []
                }, null, 2)
              }
            ],
            isError: true
          };
        } finally {
          serverState.activeRequests--;
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
          serverState.activeRequests++;
          logger.debug(`Capturing component "${component}" with variant "${variant}"`, { state, viewport });

          // Check if Storybook is connected
          if (!serverState.storybookConnected) {
            console.error({
              level: "error",
              data: "Cannot capture component: Storybook is not connected",
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: 'Storybook is not connected',
                    details: 'Cannot capture components when Storybook is unavailable'
                  }, null, 2)
                }
              ],
              isError: true
            };
          }

          // Ensure viewport has required properties with default values
          const fullViewport = {
            width: viewport.width ?? 1024,
            height: viewport.height ?? 768
          };

          // Send log for capture start
          console.error({
            level: "info",
            data: `Capturing screenshot of component: ${component}, variant: ${variant}`,
          });

          const result = await captureComponent({
            component,
            variant,
            state,
            viewport: fullViewport,
            storybookUrl: config.storybookUrl,
            outputDir: config.outputDir
          });

          logger.debug(`Successfully captured component ${component}`, result);

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
          logger.error('Error capturing component:', errorMessage);

          // Send error log to client
          console.error({
            level: "error",
            data: `Error capturing component: ${errorMessage}`,
          });

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
        } finally {
          serverState.activeRequests--;
        }
      }
  );

  // Server health check tool
  server.tool(
      "health",
      "Get server health status information",
      {},
      async () => {
        try {
          serverState.activeRequests++;
          logger.debug('Performing health check');

          // Get memory usage for health report
          const memUsage = process.memoryUsage();

          // Check if we can connect to Storybook if we're not already connected
          if (!serverState.storybookConnected) {
            try {
              const connected = await checkStorybookConnectionWithRetry(config.storybookUrl, 1, 0);
              if (connected) {
                serverState.storybookConnected = true;
                logger.info("Storybook is now connected!");
                // Stop connection checker if it's running
                stopConnectionChecker();

                // Send log message to client
                console.error({
                  level: "info",
                  data: `Storybook connection established at ${config.storybookUrl}`,
                });
              }
            } catch (e) {
              // Ignore errors, we just keep storybookConnected as false
            }
          }

          const healthInfo = {
            status: serverState.storybookConnected ? "healthy" : "degraded",
            uptime: process.uptime(),
            memory: {
              rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
              heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            },
            storybook: {
              status: serverState.storybookConnected ? "connected" : "disconnected",
              url: config.storybookUrl,
              reconnecting: !serverState.storybookConnected && storybookConnectionChecker !== null
            },
            server: {
              activeRequests: serverState.activeRequests,
            }
          };

          logger.debug('Health check result:', healthInfo);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(healthInfo, null, 2)
              }
            ]
          };
        } catch (error) {
          const errorMessage = formatErrorDetails(error);
          logger.error('Error performing health check:', errorMessage);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "error",
                  error: 'Failed to perform health check',
                  details: errorMessage
                }, null, 2)
              }
            ],
            isError: true
          };
        } finally {
          serverState.activeRequests--;
        }
      }
  );

  // Check connection status tool
  server.tool(
      "reconnect",
      "Attempt to reconnect to Storybook if disconnected",
      {},
      async () => {
        try {
          serverState.activeRequests++;

          if (serverState.storybookConnected) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    message: "Already connected to Storybook",
                    status: "connected"
                  }, null, 2)
                }
              ]
            };
          }

          logger.info("Attempting to reconnect to Storybook...");
          console.error({
            level: "info",
            data: "Attempting to reconnect to Storybook..."
          });

          const connected = await checkStorybookConnectionWithRetry(config.storybookUrl);

          if (connected) {
            serverState.storybookConnected = true;
            stopConnectionChecker();

            console.error({
              level: "info",
              data: `Successfully reconnected to Storybook at ${config.storybookUrl}`
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    message: "Successfully reconnected to Storybook",
                    status: "connected"
                  }, null, 2)
                }
              ]
            };
          } else {
            // Ensure the connection checker is running
            if (storybookConnectionChecker === null) {
              startConnectionChecker();
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    message: "Failed to reconnect to Storybook, will continue trying in the background",
                    status: "disconnected"
                  }, null, 2)
                }
              ]
            };
          }
        } catch (error) {
          const errorMessage = formatErrorDetails(error);
          logger.error('Error during reconnection attempt:', errorMessage);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: 'Failed to reconnect',
                  details: errorMessage
                }, null, 2)
              }
            ],
            isError: true
          };
        } finally {
          serverState.activeRequests--;
        }
      }
  );
}

/**
 * Start the server
 * This is the main entry point that other code should call
 */
async function runServer() {
  try {
    serverState.isRunning = true;
    logger.info('Starting Storybook MCP Server');
    logger.debug('Configuration:', JSON.stringify(config, null, 2));

    // Start memory monitoring
    startMemoryMonitor();

    // Ensure output directory exists
    await ensureOutputDir(config.outputDir);
    logger.info('Output directory ready:', config.outputDir);

    // Try to connect to Storybook, but don't fail on error
    serverState.storybookConnected = await checkStorybookConnectionWithRetry(config.storybookUrl);

    // If we couldn't connect and failOnNoStorybook is set, exit
    if (!serverState.storybookConnected && config.failOnNoStorybook) {
      throw new Error(`Failed to connect to Storybook and FAIL_ON_NO_STORYBOOK is set`);
    }

    // Start connection checker if not connected
    if (!serverState.storybookConnected) {
      logger.info("Starting background Storybook connection checker");
      startConnectionChecker();
    }

    // Setup server with all tools and resources
    setupServer();

    // Create and configure the transport
    const transport = new StdioServerTransport();

    // Handle transport errors
    transport.onerror = (error) => {
      logger.error('Transport error:', formatErrorDetails(error));
      try {
        console.error({
          level: "error",
          data: `Transport error: ${formatErrorDetails(error)}`,
        });
      } catch (e) {
        // Ignore errors when sending logs during transport error
      }
    };

    transport.onclose = () => {
      logger.info('Transport closed, initiating server shutdown');
      gracefulShutdown(0);
    };

    // Connect the server to the transport
    logger.info('Connecting transport');

    try {
      await server.connect(transport);
    } catch (error) {
      logger.error('Failed to connect transport:', formatErrorDetails(error));
      throw error;
    }

    logger.info('Storybook MCP Server running with STDIO transport');
    if (serverState.storybookConnected) {
      logger.info(`Connected to Storybook at ${config.storybookUrl}`);
    } else {
      logger.warn(`Storybook not available at ${config.storybookUrl}, server will operate in degraded mode`);
    }

    // Send server ready log to client
    console.error({
      level: "info",
      data: serverState.storybookConnected
          ? `Server ready, connected to Storybook at ${config.storybookUrl}`
          : `Server ready in degraded mode, Storybook not available at ${config.storybookUrl}`
    });

    // No need for a promise that never resolves or an artificial interval
    // The server will stay running due to the open transport connection
  } catch (error) {
    logger.error('Failed to initialize server:', formatErrorDetails(error));
    process.exit(1);
  }
}

// Register process event handlers for clean shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down server...');
  gracefulShutdown(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down server...');
  gracefulShutdown(0);
});

// Add handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log error but don't exit - this enhances stability
});

// Add handler for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', formatErrorDetails(error));
  // For uncaught exceptions, it's safer to exit with error code
  gracefulShutdown(1);
});

// Add handler to log when process is about to exit
process.on('exit', (code) => {
  logger.info(`Process exiting with code: ${code}`);
});

// Start the server
runServer().catch(error => {
  logger.error('Failed to start server:', formatErrorDetails(error));
  process.exit(1);
});