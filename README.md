# Storybook MCP Server

A lightweight server that enables AI assistants to visually analyze Storybook UI components using the Model Context Protocol (MCP).

## Features

- Discover available Storybook components and their variants
- Capture screenshots of components in different states (default, hover, focus, active)
- Customize viewport sizes for responsive testing
- Stdio transport for seamless integration with Claude for Desktop and other MCP clients

## Prerequisites

- Node.js 18+ 
- A running Storybook instance (v6.5+ recommended)

## Quick Start

1. **Install dependencies**

```bash
npm install
```

2. **Build the project**

```bash
npm run build
```

3. **Run the server**

Make sure your Storybook instance is running (typically on http://localhost:6006), then:

```bash
npm start
```

By default, the server will connect to Storybook at http://localhost:6006 and save screenshots to the `./screenshots` directory.

## Configuration

You can configure the server using environment variables:

- `STORYBOOK_URL`: URL of your Storybook instance (default: http://localhost:6006)
- `OUTPUT_DIR`: Directory for screenshot output (default: ./screenshots)
- `DEBUG`: Enable debug mode with additional logging (default: false)

Example:

```bash
STORYBOOK_URL=http://mystorybook.example.com:6006 OUTPUT_DIR=./my-screenshots npm start
```

## Integration with Claude for Desktop

To use this server with Claude for Desktop, add it to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "storybook": {
      "command": "node",
      "args": ["/path/to/storybook-mcp-server/dist/index.js"],
      "env": {
        "STORYBOOK_URL": "http://localhost:6006",
        "OUTPUT_DIR": "/path/to/screenshots"
      }
    }
  }
}
```

## Available Tools

The server implements the Model Context Protocol (MCP) and provides the following tools for AI assistants:

### `components`

Lists all available Storybook components and their variants.

**Response**:
```json
{
  "success": true,
  "count": 12,
  "components": [
    {
      "id": "button",
      "name": "Button",
      "path": "UI/Button",
      "variants": [
        {
          "id": "button--primary",
          "name": "Primary",
          "args": { "label": "Primary Button" }
        },
        {
          "id": "button--secondary",
          "name": "Secondary",
          "args": { "label": "Secondary Button" }
        }
      ]
    }
  ]
}
```

### `capture`

Captures a screenshot of a component in a specific state and viewport size.

**Parameters**:
- `component`: Component ID to capture (required)
- `variant`: Variant name (default: "Default")
- `state`: Component state with optional hover, focus and active properties
- `viewport`: Viewport dimensions with optional width and height in pixels

**Example Parameters**:
```json
{
  "component": "button--primary",
  "state": {
    "hover": true
  },
  "viewport": {
    "width": 375,
    "height": 667
  }
}
```

**Response**:
```json
{
  "success": true,
  "component": "button--primary",
  "variant": "Primary",
  "state": {
    "hover": true
  },
  "viewport": {
    "width": 375,
    "height": 667
  },
  "screenshotUrl": "file:///app/screenshots/button--primary_hover_375x667.png",
  "screenshotPath": "/app/screenshots/button--primary_hover_375x667.png"
}
```

## Available Resources

### components-list

Provides a detailed list of all components and their variants in the Storybook instance. This can be accessed as a resource with URI `components://storybook`.

## Testing

### Local Testing

Run the integration tests locally:

```bash
# Ensure your Storybook instance is running at http://localhost:6006
npm test
```

This will:
1. Build the project
2. Spawn the MCP server as a subprocess
3. Communicate with it via STDIO using the MCP protocol
4. Verify that tools and resources are working correctly

### Docker Testing

You can also run the tests using Docker Compose, which will:
1. Start a test Storybook instance
2. Run the tests against that Storybook

```bash
# Run tests in Docker
docker-compose up --build
```

The test results will be visible in the Docker logs.

### Test Environment Variables

You can customize the test environment:

- `TEST_STORYBOOK_URL`: URL of Storybook to test against
- `TEST_OUTPUT_DIR`: Directory for test screenshots

```bash
TEST_STORYBOOK_URL=http://my-storybook:6006 TEST_OUTPUT_DIR=./custom-test-output npm test
```

## Docker Support

Build and run the server in a Docker container:

```bash
# Build the Docker image
docker build -t storybook-mcp-server .

# Run the container
docker run --add-host=host.docker.internal:host-gateway storybook-mcp-server
```

The Docker container connects to the Storybook instance running on your host machine via `host.docker.internal:6006`. You can override this by setting the `STORYBOOK_URL` environment variable:

```bash
docker run -e STORYBOOK_URL=http://mystorybook.example.com:6006 storybook-mcp-server
```

### Connecting to Storybook from Docker

When running the MCP server in Docker and connecting to a Storybook instance running outside Docker (on your host machine), the following approaches can be used:

#### Option 1: Use host.docker.internal (Recommended for Docker Desktop)

If you're using Docker Desktop (Mac or Windows), the special DNS name `host.docker.internal` points to your host machine:

```bash
docker run -e STORYBOOK_URL=http://host.docker.internal:6006 storybook-mcp-server
```

For Linux hosts, you need to add the `--add-host` flag:

```bash
docker run --add-host=host.docker.internal:host-gateway -e STORYBOOK_URL=http://host.docker.internal:6006 storybook-mcp-server
```

In docker-compose.yml:
```yaml
services:
  mcp-server:
    environment:
      - STORYBOOK_URL=http://host.docker.internal:6006
    extra_hosts:
      - "host.docker.internal:host-gateway"  # For Linux hosts
```

#### Option 2: Use Host Network Mode (Linux)

On Linux, you can use the host network mode to access localhost directly:

```bash
docker run --network="host" storybook-mcp-server
```

In docker-compose.yml:
```yaml
services:
  mcp-server:
    network_mode: "host"
```

#### Option 3: Use Host Machine's IP Address

Find your host machine's IP address and use it instead of localhost:

```bash
# On Linux/Mac
ip addr show | grep "inet " | grep -v 127.0.0.1

# On Windows
ipconfig

# Then use the IP in your Docker command
docker run -e STORYBOOK_URL=http://192.168.1.100:6006 storybook-mcp-server
```

#### Running Storybook for Docker Access

When running Storybook on your host, ensure it's accessible from Docker by binding to all interfaces:

```bash
npx start-storybook -p 6006 --host 0.0.0.0
```

## Development

### Development Mode

Run the server in development mode with automatic restarts:

```bash
npm run dev
```

### Documentation

Generate API documentation:

```bash
npm run docs
```

View the documentation:

```bash
npm run docs:dev
```

### Linting

Run ESLint:

```bash
npm run lint
```

## License

MIT