import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureComponent } from "./screenshot.js";
import { getComponents } from "./components.js";

// Redirect console.log to stderr
console.log = (...args) => console.error(...args);

// Simple configuration
const config = {
    storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
    outputDir: process.env.OUTPUT_DIR || './screenshots'
};

// Create the MCP server
const server = new McpServer({
    name: "Storybook-MCP-Server",
    version: "1.0.0"
});

// List components tool
server.tool(
    "components",
    {},
    async () => {
        try {
            const components = await getComponents(config.storybookUrl);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, count: components.length, components }, null, 2)
                }]
            };
        } catch (error) {
            console.error('Error fetching components:', error);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: 'Failed to retrieve components' }, null, 2)
                }],
                isError: true
            };
        }
    }
);

// Capture screenshot tool
server.tool(
    "capture",
    {
        component: z.string(),
        variant: z.string().optional().default("Default"),
        state: z.object({
            hover: z.boolean().optional(),
            focus: z.boolean().optional(),
            active: z.boolean().optional()
        }).optional().default({}),
        viewport: z.object({
            width: z.number().optional(),
            height: z.number().optional()
        }).optional().default({ width: 1024, height: 768 })
    },
    async (params) => {
        try {
            const result = await captureComponent({
                component: params.component,
                variant: params.variant || "Default",
                storybookUrl: config.storybookUrl,
                outputDir: config.outputDir,
                state: params.state || {},
                viewport: {
                    width: params.viewport?.width ?? 1024,
                    height: params.viewport?.height ?? 768
                }
            });

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, ...result }, null, 2)
                }]
            };
        } catch (error) {
            console.error('Error capturing component:', error);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: 'Failed to capture component' }, null, 2)
                }],
                isError: true
            };
        }
    }
);

// Handle unexpected errors
process.on('uncaughtException', error => console.error('Uncaught exception:', error));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

// Start the server
const transport = new StdioServerTransport();
transport.onerror = error => console.error('Transport error:', error);


try {
    await server.connect(transport);
    console.error('Storybook MCP Server running');
} catch (error) {
    console.error('Failed to connect server:', error);
    process.exit(1);
}

setInterval(() => {
    console.error('Heartbeat check - server still running');
}, 10000);