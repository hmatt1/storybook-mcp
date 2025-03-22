#!/bin/bash

# Exit on error
set -e

# Create output directory if it doesn't exist
mkdir -p test-output

# Check if Docker Compose is available
if command -v docker compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "Docker Compose not found. Installing Docker Compose..."
    pip install docker-compose
    DOCKER_COMPOSE_CMD="docker-compose"
fi

echo "Creating test-storybook directory structure if needed..."
# Ensure all test-storybook directories exist
mkdir -p test-storybook/.storybook
mkdir -p test-storybook/src/components

echo "Building and starting test environment..."
$DOCKER_COMPOSE_CMD -f docker-compose.test.yml build
$DOCKER_COMPOSE_CMD -f docker-compose.test.yml up --abort-on-container-exit

# Check exit code of test-runner container
TEST_EXIT_CODE=$($DOCKER_COMPOSE_CMD -f docker-compose.test.yml ps -q test-runner | xargs docker inspect -f '{{.State.ExitCode}}')

echo "Cleaning up test environment..."
$DOCKER_COMPOSE_CMD -f docker-compose.test.yml down

# Display test results summary
echo ""
echo "================================"
echo "      TEST RESULTS SUMMARY      "
echo "================================"

if [ "$TEST_EXIT_CODE" -eq "0" ]; then
    echo "✅ All tests passed successfully!"
    
    # List generated screenshots
    echo ""
    echo "Screenshots generated:"
    ls -la test-output/*.png 2>/dev/null || echo "No screenshots found."
else
    echo "❌ Tests failed with exit code: $TEST_EXIT_CODE"
    echo "Check the logs above for more details."
fi

exit $TEST_EXIT_CODE
