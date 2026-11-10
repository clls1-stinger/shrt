FROM oven/bun:1.2-debian
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.ts .
USER bun
CMD ["bun", "run", "server.ts"]
