FROM node:22-bookworm-slim

# iTMSTransporter needs a JRE
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-jre-headless ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Apple Transporter command line tool.
# Download the Linux installer (iTMSTransporter_installer_linux_x64_*.sh) from Apple,
# put it in a tar.gz next to this Dockerfile as transporter.tar.gz.
COPY transporter.tar.gz /tmp/transporter.tar.gz
RUN mkdir -p /opt/transporter \
  && tar -xzf /tmp/transporter.tar.gz -C /tmp \
  && chmod +x /tmp/iTMSTransporter_installer_linux_x64_*.sh \
  && cd /opt/transporter \
  && /tmp/iTMSTransporter_installer_linux_x64_*.sh --tar xf \
  && rm -f /tmp/transporter.tar.gz /tmp/iTMSTransporter_installer_linux_x64_*.sh \
  && BIN="$(find /opt/transporter -name 'iTMSTransporter' -type f | head -n1)" \
  && test -n "$BIN" \
  && chmod +x "$BIN" \
  && ln -sf "$BIN" /usr/local/bin/iTMSTransporter \
  && echo "Transporter installed at $BIN"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.js"]
