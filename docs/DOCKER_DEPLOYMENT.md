# Docker Deployment Guide

This document explains how to work with the GitHub Actions workflow for building and deploying the storybook-mcp server to Docker Hub.

## GitHub Actions Workflow

The project includes a GitHub Actions workflow file (`.github/workflows/docker-build-push.yml`) that automatically builds and pushes the Docker image to Docker Hub when:

- Changes are pushed to the main/master branch
- A new tag is created with the format `v*` (e.g., v1.0.0)
- A pull request is created targeting the main/master branch (builds but doesn't push)
- The workflow is manually triggered via GitHub Actions UI

## Required Secrets

To enable the workflow to push images to Docker Hub, you need to add the following secrets to your GitHub repository:

1. Go to your GitHub repository
2. Navigate to Settings > Secrets and variables > Actions
3. Add the following repository secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: A Docker Hub access token (not your password)

## Creating a Docker Hub Access Token

1. Log in to your Docker Hub account
2. Click on your username in the top-right corner and select "Account Settings"
3. Navigate to "Security" > "New Access Token"
4. Enter a description (e.g., "GitHub Actions") and click "Generate"
5. Copy the generated token and add it as the `DOCKERHUB_TOKEN` secret in GitHub

## Docker Image Tags

The workflow creates Docker images with the following tag strategies:

- For branches: `hmatt1/storybook-mcp:branch-{branch-name}`
- For pull requests: `hmatt1/storybook-mcp:pr-{pr-number}`
- For version tags (e.g., v1.2.3):
  - `hmatt1/storybook-mcp:1.2.3`
  - `hmatt1/storybook-mcp:1.2`
- For commits to the default branch: `hmatt1/storybook-mcp:latest`
- For all commits: `hmatt1/storybook-mcp:sha-{short-sha}`

## Manual Deployment

If you prefer to manually build and push the Docker image, you can use:

```bash
# Build the image
docker build -t hmatt1/storybook-mcp:latest .

# Push to Docker Hub
docker push hmatt1/storybook-mcp:latest

# To tag with a specific version and push
docker tag hmatt1/storybook-mcp:latest hmatt1/storybook-mcp:1.0.0
docker push hmatt1/storybook-mcp:1.0.0
```

## Development Process

1. Make changes to the codebase
2. Commit and push to a feature branch
3. Create a pull request targeting the main branch
4. After PR is approved and merged:
   - The image will be automatically built and pushed to Docker Hub with the `:latest` tag
5. For releases:
   - Create and push a tag with the format `v1.0.0`
   - The workflow will create versioned tags automatically
