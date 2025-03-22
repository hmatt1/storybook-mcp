FROM node:18-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package.json first
COPY package.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Build Storybook
RUN npm run build-storybook

# Expose Storybook port
EXPOSE 6006

# Start Storybook
CMD ["npm", "run", "storybook", "--", "--no-open", "--ci"]
