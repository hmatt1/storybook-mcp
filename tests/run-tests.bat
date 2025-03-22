@echo off
setlocal enabledelayedexpansion

echo ==================================
echo Storybook MCP Server Test Runner
echo ==================================

:: Create output directory if it doesn't exist
if not exist test-output mkdir test-output

echo Creating test environment...

:: Check if Docker Compose v2 (docker compose) or v1 (docker-compose) is available
docker compose version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set DOCKER_COMPOSE_CMD=docker compose
) else (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        set DOCKER_COMPOSE_CMD=docker-compose
    ) else (
        echo Error: Docker Compose not found. Please install Docker Compose.
        exit /b 1
    )
)

echo Building containers...
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml build --no-cache --progress plain

echo Starting test environment...
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml up -d

:: Install test dependencies if needed
if not exist tests\node_modules (
    echo Installing test dependencies...
    cd tests
    npm install
    cd ..
)

:: Wait a moment for containers to initialize
echo Waiting for containers to start...
timeout /t 10 /nobreak > nul

:: Run the tests
echo Running tests...
node tests\run-tests.js
set TEST_EXIT_CODE=%ERRORLEVEL%

:: Display test results summary based on exit code
echo.
echo ================================
echo       TEST RESULTS SUMMARY      
echo ================================

if %TEST_EXIT_CODE% EQU 0 (
    echo [92m✓ All tests passed successfully![0m
    
    :: List generated screenshots
    echo.
    echo Screenshots generated:
    dir /b test-output\*.png 2>nul || echo No screenshots found.
) else (
    echo [91m✗ Tests failed with exit code: %TEST_EXIT_CODE%[0m
    echo Check the logs above for more details.
)

:: Clean up test environment
echo Cleaning up test environment...
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml down

exit /b %TEST_EXIT_CODE%
