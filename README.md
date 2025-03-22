# Storybook MCP Server

A lightweight server that enables AI assistants to visually analyze Storybook UI components using the Model Context Protocol (MCP).

## Features

- Discover available Storybook components and their variants
- Capture screenshots of components in different states (default, hover, focus, active)
- Customize viewport sizes for responsive testing
- Docker support for easy deployment

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

Example:

```bash
STORYBOOK_URL=http://mystorybook.example.com:6006 OUTPUT_DIR=./my-screenshots npm start
```

## Available Tools

The server implements the Model Context Protocol (MCP) and provides the following tools for AI assistants:

### `components`

Lists all available Storybook components and their variants.

**Usage**:
```json
{
  "tool": "components"
}
```

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
- `state`: Component state - "default", "hover", "focus", or "active" (default: "default")
- `width`: Viewport width in pixels (default: 1024)
- `height`: Viewport height in pixels (default: 768)

**Usage**:
```json
{
  "tool": "capture",
  "parameters": {
    "component": "button--primary",
    "state": "hover",
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
  "state": "hover",
  "viewport": {
    "width": 375,
    "height": 667
  },
  "screenshotUrl": "file:///app/screenshots/button--primary_hover_375x667.png",
  "screenshotPath": "/app/screenshots/button--primary_hover_375x667.png"
}
```

## Docker Support

Build and run the server in a Docker container:

```bash
# Build the Docker image
docker build -t storybook-mcp-server .

# Run the container
docker run -p 3000:3000 --add-host=host.docker.internal:host-gateway storybook-mcp-server
```

The Docker container connects to the Storybook instance running on your host machine via `host.docker.internal:6006`. You can override this by setting the `STORYBOOK_URL` environment variable:

```bash
docker run -p 3000:3000 -e STORYBOOK_URL=http://mystorybook.example.com:6006 storybook-mcp-server
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

### Testing

Run the integration tests:

```bash
npm test
```

## License

MIT
