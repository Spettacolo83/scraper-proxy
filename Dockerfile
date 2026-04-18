FROM mcr.microsoft.com/playwright:v1.59.1-noble

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Create tailscale socket directory
RUN mkdir -p /var/run/tailscale

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
