FROM mcr.microsoft.com/playwright:v1.41.1-focal

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build TypeScript
RUN npm run build

# Install Playwright browsers
RUN npx playwright install chromium

# Create directory for screenshots
RUN mkdir -p ./screenshots

# Set environment variables
ENV NODE_ENV=production
ENV STORYBOOK_URL=http://host.docker.internal:6006
ENV OUTPUT_DIR=/app/screenshots
ENV PORT=3000

# Add additional browser launch arguments for Docker
ENV PLAYWRIGHT_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage"

# Run the application
CMD ["node", "dist/index.js"]
