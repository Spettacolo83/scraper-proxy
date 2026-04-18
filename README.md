# Scraper Proxy

Playwright-based scraping proxy that renders pages with a headless Chromium browser, bypassing Cloudflare and JS-rendered content.

## API

### GET /fetch?url=<encoded_url>[&format=text]
Renders the URL and returns the HTML (or text if format=text).

Requires `X-API-Key` header.

### GET /health
Health check endpoint (no auth required).

### GET /admin
Admin dashboard for managing API keys, rate limits, and whitelist.

## Deploy

Built for EasyPanel deployment via Docker. See Dockerfile.

## Config

On first start, copies `config.default.json` to `data/config.json`. All config changes via the admin dashboard are persisted to this file.
