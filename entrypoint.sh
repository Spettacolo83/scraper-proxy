#!/bin/bash

# Start Tailscale in userspace networking mode with SOCKS5 proxy
tailscaled --tun=userspace-networking \
  --socks5-server=localhost:1055 \
  --state=/app/data/tailscaled.state \
  --socket=/var/run/tailscale/tailscaled.sock &

# Wait for tailscaled to be ready
sleep 3

# Authenticate and connect to tailnet
tailscale up --authkey=${TAILSCALE_AUTHKEY} --hostname=scraper-proxy

echo "Tailscale connected. IP: $(tailscale ip -4)"
echo "SOCKS5 proxy on localhost:1055"

# Export for Node.js to use
export TAILSCALE_SOCKS5=socks5://localhost:1055

# Start the Node.js app
exec node src/server.js
