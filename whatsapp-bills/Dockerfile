# Sale bills to WhatsApp (server.mjs). Chromium draws a bill typed in the
# panel, which has no photo, as it prints (print-server/template.mjs, put
# beside this by `npm run deploy` with the shop's letterhead in public/assets).
FROM node:22-bookworm-slim
# Claude Code decides which supplier-chat photos are bill slips (slip-check.mjs),
# signed in by CLAUDE_CODE_OAUTH_TOKEN; the same version as whatsapp-reminders.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@2.1.330 && claude --version
ENV PUPPETEER_SKIP_DOWNLOAD=true CHROME_PATH=/usr/bin/chromium NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.mjs"]
