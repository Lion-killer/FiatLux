# FiatLux Docker Support

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Expose API port
EXPOSE 3000

# Start the service
CMD ["npm", "start"]
