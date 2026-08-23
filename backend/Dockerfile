# Use Node.js 22 Alpine image
FROM node:22-alpine

# Install a basic font stack so Sharp/librsvg can render SVG text
RUN apk add --no-cache fontconfig ttf-dejavu
# yt-dlp + ffmpeg power the leaderboard clip hosting (download a clip's video
# and re-host it on our own player). Both live in Alpine's community repo,
# which is already enabled in the node:*-alpine base image. ffmpeg lets
# yt-dlp merge separate video/audio streams (YouTube) into one mp4.
RUN apk add --no-cache yt-dlp ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
