# Zmind Desktop

Electron desktop shell for the Zmind web app, with deep-link login callback support.

## Features

- Native desktop app packaging: macOS / Windows / Linux
- Deep linking via `zmind://` for auth callbacks
- OAuth popup flow isolated from main app window
- Basic desktop navigation (Back, Forward, Reload, Open in browser)

## Development

```bash
npm install
npm start
```

## Configuration

Environment variables:

- `APP_URL` (optional): web app origin to load in desktop shell
- `DESKTOP_PROTOCOL_SCHEME` (optional): custom protocol scheme, default `zmind`

Example:

```bash
APP_URL=http://localhost:3000 npm start
```

Default `APP_URL` is `https://zmind.so/`.

## Build

```bash
npm run build              # all configured targets
npm run build:mac          # macOS (signed if .env credentials exist)
npm run build:mac:unsigned # macOS unsigned
npm run build:win          # Windows NSIS
npm run build:linux        # Linux AppImage
```

For macOS signing/notarization, copy `.env.example` to `.env` and provide Apple credentials.
