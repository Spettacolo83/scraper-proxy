#!/bin/bash

# Start Tailscale in userspace networking mode (no /dev/net/tun needed)
tailscaled --tun=userspace-networking --state=/app/data/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Wait for tailscaled to be ready
sleep 3

# Authenticate and connect to tailnet
tailscale up --authkey=${TAILSCALE_AUTHKEY} --hostname=scraper-proxy

# Set up SOCKS5 proxy for Tailscale network access
# In userspace mode, we use Tailscale's built-in SOCKS5/HTTP proxy
export ALL_PROXY=socks5://localhost:1055

echo "Tailscale connected. IP: $(tailscale ip -4)"

# Start the Node.js app
exec node src/server.js
