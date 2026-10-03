FROM node:20-slim

# ffmpeg + fonts for video rendering, python3 + edge-tts for natural voice
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core python3 python3-pip
RUN apt-get clean
RUN pip3 install --no-cache-dir --break-system-packages edge-tts || pip3 install --no-cache-dir edge-tts

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
