# OpenReply HTML Site

Static marketing + auth + activation site for OpenReply.

## Quick Start

```bash
cd act_suit/html_site
cp .env.example .env
npm run build
npm run check
npm run dev
```

Open `http://localhost:5173`.

## Scripts

- `npm run build` - Generate `env.config.js` from `.env.example`, `.env`, and deploy env.
- `npm run build:sample` - Generate placeholder `env.config.js` from `.env.example` only.
- `npm run check` - Validate required runtime keys are set in `env.config.js`.
- `npm run dev` - Serve static files on port `5173`.

## Optional Frontend Flow Variables

- `APP_DOWNLOAD_URL` - direct desktop installer URL for marketing/activation download buttons.
- `APP_DEEP_LINK_URL` - desktop custom-scheme URL used by post-activation "Open desktop app"
  (default fallback is `openreply://dashboard`).

## Structure

- `index.html`, `marketing*.html`, `sign-in.html`, `activate.html` - public entry pages.
- `site-auth.js` - shared auth/session/activation runtime.
- `generate-env-config.mjs` - environment bridge for browser config.
- `.env.example` - env template and security notes.
- `scripts/check-env.mjs` - runtime config validator.
- `vercel.json` - static deployment + security headers.
- `DEPLOY.md` - deployment and security guidance.

## Security Boundaries

- `env.config.js` is public (loaded in browser).
- Never put server-only secrets into `PUBLIC_ENV_KEYS` in `generate-env-config.mjs`.
- Keep service role keys, webhook secrets, and API secrets on backend/Edge functions only.
