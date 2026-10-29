FROM node:20-slim

# ffmpeg + fonts for video, python3 + TTS/PDF libraries for voice and lesson PDFs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core python3 python3-pip \
    && apt-get clean \
    && find /var/lib/apt/lists -mindepth 1 -delete
RUN pip3 install --no-cache-dir --break-system-packages "edge-tts>=7.3.1" reportlab arabic-reshaper python-bidi || pip3 install --no-cache-dir "edge-tts>=7.3.1" reportlab arabic-reshaper python-bidi

WORKDIR /app

# Copy the lockfile too and install with `npm ci` so builds are reproducible.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY masjid-docs.html ./
COPY lib/ lib/
COPY scripts/ scripts/
COPY fonts/ fonts/

ENV NODE_ENV=production
ENV WORK_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 5000

# The landing page answers without an API key, so it works as a liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
