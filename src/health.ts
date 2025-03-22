/**
 * Health check endpoint for the MCP server
 * Used by Docker health checks and test runners to verify server status
 */

import http from 'http';

// Store global configuration for health checks
let globalConfig: { storybookUrl: string } = {
  storybookUrl: ''
};

/**
 * Create and start a simple HTTP server for health checks
 * @param port - The port to listen on (default: 3000)
 */
export function startHealthServer(port: number = 3000, config?: { storybookUrl: string }): void {
  if (config) {
    globalConfig = config;
  }
  
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok',
        storybookUrl: globalConfig.storybookUrl 
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`Health check server running on port ${port}`);
  });
}

/**
 * Update the configuration used by the health check server
 * @param config - Configuration object with properties to update
 */
export function updateHealthConfig(config: Partial<typeof globalConfig>): void {
  Object.assign(globalConfig, config);
}
