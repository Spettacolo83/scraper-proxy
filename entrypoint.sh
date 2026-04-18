#!/bin/bash

# Start Tailscale daemon in background
tailscaled --state=/app/data/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Wait for tailscaled to be ready
sleep 2

# Authenticate and connect to tailnet
tailscale up --authkey=${TAILSCALE_AUTHKEY} --hostname=scraper-proxy

echo "Tailscale connected. IP: $(tailscale ip -4)"

# Start the Node.js app
exec node src/server.js
