import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { captureComponent } from "./screenshot.js";
import { getComponents } from "./components.js";

// Redirect console.log to stderr
console.log = (...args) => console.error(...args);

// Simple configuration
const config = {
    storybookUrl: process.env.STORYBOOK_URL || 'http://localhost:6006',
    outputDir: process.env.OUTPUT_DIR || './screenshots'
};

const server = new Server(
    {
        name: "Storybook-MCP-Server",
        version: "1.0.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
            logging: {},
        },
    }
);

// Define tools
const COMPONENTS_TOOL: Tool = {
    name: "components",
    description: "List all available Storybook components",
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
    },
};

const CAPTURE_TOOL: Tool = {
    name: "capture",
    description: "Capture a screenshot of a Storybook component",
    inputSchema: {
        type: "object",
        properties: {
            component: {
                type: "string",
                description: "The name of the component to capture",
            },
            variant: {
                type: "string",
                description: "The variant of the component to capture",
            },
            state: {
                type: "object",
                properties: {
                    hover: { type: "boolean" },
                    focus: { type: "boolean" },
                    active: { type: "boolean" },
                },
                description: "Component state to capture",
            },
            viewport: {
                type: "object",
                properties: {
                    width: { type: "number" },
                    height: { type: "number" },
                },
                description: "Viewport dimensions for the screenshot",
            },
        },
        required: ["component"],
    },
};

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [COMPONENTS_TOOL, CAPTURE_TOOL],
}));

// Function implementations



// Function implementations
async function doComponents() {
    try {
        const components = await getComponents(config.storybookUrl);
        const componentsData = {
            count: components.length,
            components
        };

        // Format the response as a text content for better readability
        const componentsText = `Found ${componentsData.count} components:\n` +
            componentsData.components.map(comp =>
                `- ${comp.name} (${comp.variants.length} variants)`
            ).join('\n');

        return {
            content: [
                {
                    type: "text",
                    text: componentsText
                }
            ],
            _meta: {}
        };
    } catch (error) {
        console.error('Error fetching components:', error);
        throw new McpError(ErrorCode.InternalError, 'Failed to retrieve components');
    }
}

async function doCapture(input: {
    component: string;
    variant?: string;
    state?: {
        hover?: boolean;
        focus?: boolean;
        active?: boolean;
    };
    viewport?: {
        width?: number;
        height?: number;
    };
}) {
    try {
        const result = await captureComponent({
            component: input.component,
            variant: input.variant || "Default",
            storybookUrl: config.storybookUrl,
            outputDir: config.outputDir,
            state: input.state || {},
            viewport: {
                width: input.viewport?.width ?? 1024,
                height: input.viewport?.height ?? 768
            }
        });

        // Format the capture result as text content
        const captureText = `Screenshot captured:
Component: ${input.component}
Variant: ${input.variant || "Default"}
File: ${result.screenshotPath || "Unknown"}
URL: ${result.screenshotUrl || "Unknown"}`;

        return {
            content: [
                {
                    type: "text",
                    text: captureText
                }
            ],
            _meta: {}
        };
    } catch (error) {
        console.error('Error capturing component:', error);
        throw new McpError(ErrorCode.InternalError, 'Failed to capture component');
    }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "components") {
        console.error("Components tool", request.params.arguments);
        return await doComponents();
    }

    if (request.params.name === "capture") {
        console.error("Capture tool", request.params.arguments);
        const input = request.params.arguments as {
            component: string;
            variant?: string;
            state?: {
                hover?: boolean;
                focus?: boolean;
                active?: boolean;
            };
            viewport?: {
                width?: number;
                height?: number;
            };
        };
        return await doCapture(input);
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
});

// Handle errors
server.onerror = (error) => {
    console.error('Server error:', error);
};

// Handle process termination
process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
});

// Handle unexpected errors
process.on('uncaughtException', error => console.error('Uncaught exception:', error));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

// Run the server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Storybook MCP Server running on stdio');
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});