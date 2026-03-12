FROM node:20-slim

# Playwright Chromium 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 설치
COPY package.json package-lock.json* ./
RUN npm ci --production

# Playwright Chromium만 설치 (메모리 절약)
RUN npx playwright install chromium

# 소스 복사 & 빌드
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

EXPOSE 4000

CMD ["node", "dist/server.js"]
