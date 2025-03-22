@echo off
setlocal enabledelayedexpansion

:: Create output directory if it doesn't exist
if not exist test-output mkdir test-output

:: Create test-storybook directory structure if needed
if not exist test-storybook mkdir test-storybook
if not exist test-storybook\.storybook mkdir test-storybook\.storybook
if not exist test-storybook\src mkdir test-storybook\src
if not exist test-storybook\src\components mkdir test-storybook\src\components

echo Building and starting test environment...

:: Check if Docker Compose v2 (docker compose) or v1 (docker-compose) is available
docker compose version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set DOCKER_COMPOSE_CMD=docker compose
) else (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        set DOCKER_COMPOSE_CMD=docker-compose
    ) else (
        echo Docker Compose not found. Please install Docker Compose.
        exit /b 1
    )
)

:: Build and start containers
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml build
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml up --abort-on-container-exit

:: Get the exit code of the test-runner container
for /f %%i in ('%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml ps -q test-runner') do (
    for /f %%j in ('docker inspect -f "{{.State.ExitCode}}" %%i') do (
        set TEST_EXIT_CODE=%%j
    )
)

echo Cleaning up test environment...
%DOCKER_COMPOSE_CMD% -f docker-compose.test.yml down

:: Display test results summary
echo.
echo ================================
echo       TEST RESULTS SUMMARY      
echo ================================

if "%TEST_EXIT_CODE%" == "0" (
    echo ✅ All tests passed successfully!
    
    :: List generated screenshots
    echo.
    echo Screenshots generated:
    dir /b test-output\*.png 2>nul || echo No screenshots found.
) else (
    echo ❌ Tests failed with exit code: %TEST_EXIT_CODE%
    echo Check the logs above for more details.
)

exit /b %TEST_EXIT_CODE%
