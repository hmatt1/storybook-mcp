// file: src/index.ts
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
import fs from 'fs';

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
async function doComponents() {
    try {
        const components = await getComponents(config.storybookUrl);

        // Map over the components and update each component's ID to use its first variant's ID
        const updatedComponents = components.map(component => {
            // Only update the ID if the component has at least one variant
            if (component.variants && component.variants.length > 0) {
                return {
                    ...component,
                    id: component.variants[0].id
                };
            }
            return component;
        });

        const componentsData = {
            success: true,
            count: updatedComponents.length,
            updatedComponents
        };

        // Return JSON data as a JSON string in the text content
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(componentsData)
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

        // Create metadata as JSON for the test script
        const metadataJson = JSON.stringify({
            success: true,
            component: input.component,
            variant: input.variant || "Default",
            screenshotPath: result.screenshotPath || null,
            screenshotUrl: result.screenshotUrl || null
        });

        // Check if the screenshot file exists
        if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
            // Read the image file and convert to base64
            const imageBuffer = fs.readFileSync(result.screenshotPath);
            const base64Image = imageBuffer.toString('base64');

            // Determine MIME type based on file extension
            const mimeType = result.screenshotPath.endsWith('.png')
                ? 'image/png'
                : 'image/jpeg';

            return {
                content: [
                    // Include the metadata as text
                    {
                        type: "text",
                        text: metadataJson
                    },
                    // Include the actual image
                    {
                        type: "image",
                        data: base64Image,
                        mimeType: mimeType
                    }
                ],
                _meta: {}
            };
        } else {
            // If no image file, just return metadata
            return {
                content: [
                    {
                        type: "text",
                        text: metadataJson
                    }
                ],
                _meta: {}
            };
        }
    } catch (error) {
        console.error('Error capturing component:', error);

        // Return a structured error response
        const errorData = JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });

        return {
            content: [
                {
                    type: "text",
                    text: errorData
                }
            ],
            _meta: {}
        };
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