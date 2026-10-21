# Use the base image with Node.js 22.23.2
FROM node:22.23.2

# Copy the current directory into the Docker image
COPY . /file-scanner-processor

# Set working directory for future use
WORKDIR /file-scanner-processor

# Install the dependencies from package.json
RUN yarn install --frozen-lockfile
