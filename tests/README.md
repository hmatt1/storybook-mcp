# MCP Server Integration Tests

This directory contains integration tests for the Storybook MCP Server. These tests verify that the server can properly interact with a Storybook instance and provide the expected functionality.

## How the Tests Work

The tests use Docker Compose to create a containerized environment with three main components:

1. **Storybook Container**: Runs a test Storybook instance with predefined Button components
2. **MCP Server Container**: Connects to the Storybook instance and exposes the MCP API
3. **Test Runner Container**: Executes tests against the MCP server API

The test process follows these steps:

1. **Setup**: Docker Compose builds and starts all containers
2. **Discovery**: The test runner waits for the MCP server to initialize and verifies component discovery
3. **Capture**: Tests request screenshots of components in different states and viewport sizes
4. **Validation**: Tests verify screenshots exist and have valid content
5. **Cleanup**: The environment is torn down automatically after tests complete

## Running the Tests

### Prerequisites

- Docker and Docker Compose installed
- Node.js and npm installed

### Running tests locally

On Linux/macOS:
```
npm run test:integration
```

On Windows:
```
npm run test:integration
```

The test script automatically detects your platform and uses the appropriate shell script.

### What to expect

When running tests, you should see:

1. Docker containers being built and started
2. Test progress output from the test runner
3. A summary of test results
4. Generated screenshots in the `test-output` directory

### CI/CD Integration

These tests are automatically run in GitHub Actions workflow before building and pushing the Docker image. The workflow will:

1. Run the integration tests
2. Upload any generated screenshots as build artifacts
3. Only proceed to build and push the Docker image if all tests pass

## Test Components

The test environment includes Button components with different variants:

- Primary button
- Secondary button
- Success button
- Danger button
- Large button
- Small button

These components are designed to test various aspects of the MCP server, including:

- Component discovery
- Screenshot capture
- State handling (hover, active)
- Responsive behavior

## Troubleshooting

If tests fail, check:

1. Docker is running and has sufficient resources
2. No conflicts with ports 3000 (MCP server) or 6006/6007 (Storybook)
3. The `test-output` directory exists and is writable
4. Docker Compose is installed and working correctly
