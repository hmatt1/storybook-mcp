#!/bin/bash

# Exit on error
set -e

echo "Building project..."
npm run build

echo "Running test storybook instance..."
# Start a test Storybook instance (replace with your test Storybook command)
# For example, using http-server to serve a static Storybook build
if [ -d "test-storybook" ]; then
  npx http-server test-storybook -p 6007 &
  STORYBOOK_PID=$!
  
  # Give Storybook time to start
  sleep 5
  
  echo "Running tests against test Storybook..."
  # Use custom Storybook URL for tests
  STORYBOOK_URL=http://localhost:6007 node dist/index.js &
  SERVER_PID=$!
  
  # Give server time to start
  sleep 2
  
  # Add your test commands here
  # For example:
  echo "Test: Get components"
  curl -s -X POST http://localhost:3000/tools/components | jq
  
  echo "Test: Capture component"
  curl -s -X POST http://localhost:3000/tools/capture \
    -H "Content-Type: application/json" \
    -d '{"component":"button--primary","variant":"Default"}' | jq
  
  # Cleanup
  kill $SERVER_PID
  kill $STORYBOOK_PID
else
  echo "No test Storybook found. Skipping integration tests."
  echo "To run integration tests, create a 'test-storybook' directory with a Storybook build."
fi

echo "All tests completed successfully!"
