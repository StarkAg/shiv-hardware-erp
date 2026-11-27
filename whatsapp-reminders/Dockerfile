# Birthday reminders to the owner's chat (server.mjs).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# Claude Code reads "order" photos from the shop group (order-read.mjs), signed
# in by CLAUDE_CODE_OAUTH_TOKEN; ca-certificates for its HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@2.1.330 && claude --version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.mjs"]
