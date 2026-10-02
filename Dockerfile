FROM node:20-slim

# ffmpeg + fonts are required for video rendering
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV NODE_ENV=production
ENV WORK_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 5000
CMD ["node", "server.js"]
