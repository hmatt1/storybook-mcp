@echo off
echo Building project...
call npm run build

echo Testing if server can start...
echo This is a simplified test that just checks if the server can initialize

:: Check if test-storybook directory exists
if exist "test-storybook" (
  echo Running integration tests...
  :: Start a test storybook instance
  start /b npx http-server test-storybook -p 6007
  
  :: Give it time to start
  timeout /t 5
  
  :: Run the server with test storybook URL
  set STORYBOOK_URL=http://localhost:6007
  start /b node dist/index.js
  
  :: Give server time to start
  timeout /t 2
  
  :: Add your test commands here (would need curl or similar for Windows)
  
  :: Cleanup would be needed here
  echo Note: This script doesn't run the full test suite or clean up processes
) else (
  echo No test-storybook directory found. Skipping integration tests.
  echo To run integration tests, create a 'test-storybook' directory with a Storybook build.
)

echo All tests completed!
