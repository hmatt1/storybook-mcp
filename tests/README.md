# Storybook MCP Server Tests

This directory contains integration tests for the Storybook MCP Server. The tests verify that the server correctly implements the Model Context Protocol (MCP) and can interact with a Storybook instance.

## Test Structure

- `run-tests.js`: Main test script that connects to the MCP server and verifies functionality
- `run-tests.bat`: Windows batch script for running tests in Docker
- `Dockerfile.test`: Dockerfile for the test runner container

## What's Being Tested

The tests verify:

1. **Component Discovery**: The MCP server can correctly discover all components from Storybook
2. **Screenshot Capture**: Components can be captured in different states (default, hover, etc.)
3. **Responsive Testing**: Components can be captured at different viewport sizes
4. **Output Verification**: Screenshots are correctly saved to the output directory

## Running the Tests

### Using Docker (Recommended)

```bash
# From the project root
npm run test
```

This runs the tests in a Docker environment that includes:
- A test Storybook instance
- The MCP server connected to that instance
- The test runner that verifies functionality

### Running Tests Locally

If you have a Storybook instance running on `http://localhost:6006` and the MCP server on `http://localhost:3000`:

```bash
cd tests
npm install
node run-tests.js
```

You can customize the URLs with environment variables:

```bash
cd tests
npm install
MCP_SERVER_URL=http://localhost:3000 OUTPUT_DIR=../test-output node run-tests.js
```

## Test Output

The tests generate:
- Console output with test results
- Screenshot files in the `test-output` directory
