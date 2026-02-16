# FiatLux Docker Support

# --- Build stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for tsc)
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# --- Production stage ---
FROM node:18-alpine

WORKDIR /app

# Copy package files and install production only
COPY package*.json ./
RUN npm install --omit=dev

# Copy built output and public files from builder
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# Expose API port
EXPOSE 8080

# Start the service
CMD ["npm", "start"]
