FROM node:20-bookworm-slim

# FFmpeg ve gerekli sistem araçlarını kur
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    python3 \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Paket tanımlarını kopyala
COPY package.json ./

# Kodları ve web arayüzünü kopyala
COPY . .

# Medya dizinini oluştur
RUN mkdir -p /app/media

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.mjs"]
