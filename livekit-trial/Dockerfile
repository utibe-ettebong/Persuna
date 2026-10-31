# The trial agent on LiveKit Cloud. It runs from source with tsx, as `npm start`
# does, so there's no build step.
FROM node:22-slim

# The LiveKit SDK reads the system trust store, which the slim image doesn't ship.
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
RUN npx livekit-agents download-files
COPY . .

RUN adduser --disabled-password --gecos "" --home /app --shell /sbin/nologin --uid 10001 appuser
RUN chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/main.ts", "start"]
