FROM node:20-bookworm-slim

# iTMSTransporter needs a JRE
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-jre-headless ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Apple Transporter command line tool.
# Download iTMSTransporter from https://itunesconnect.apple.com/apploader/itmstransporter_linux.tar.gz
# (or copy the macOS install) and place the archive next to this Dockerfile as transporter.tar.gz
COPY transporter.tar.gz /tmp/transporter.tar.gz
RUN mkdir -p /opt/transporter \
  && tar -xzf /tmp/transporter.tar.gz -C /opt/transporter \
  && rm /tmp/transporter.tar.gz
ENV TRANSPORTER_PATH=/opt/transporter/itms/bin/iTMSTransporter
ENV PATH="/opt/transporter/itms/bin:${PATH}"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.js"]
