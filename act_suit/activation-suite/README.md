## Activation Suite (Local-first + Supabase)

This service exposes:

- `GET /api/v1/health`
- `POST /api/v1/device/activate`
- `POST /api/v1/dev/mint` (dev-only helper, protected by secret header)
- `GET /v1/health` (desktop app-compatible route)
- `POST /v1/device/activate` (desktop app-compatible route)

It runs in two modes:

1. **Supabase mode** (preferred): if `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set.
2. **File fallback mode**: if env vars are missing, it writes local data to `data/licenses.json`.

## Local Supabase Setup (CLI)

From `act_suit/activation-suite`:

```bash
supabase start
supabase db reset
```

`supabase db reset` applies `supabase/migrations/*` including activation tables.

## Configure env

```bash
cp .env.example .env.local
supabase status
```

Set:

- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` (required for frontend auth)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>` (required for frontend auth)
- `SUPABASE_URL=http://127.0.0.1:54321` (server-side Supabase client)
- `SUPABASE_SERVICE_ROLE_KEY=<optional, for elevated server-only access>`
- `DEV_MINT_SECRET=<long random secret for dev mint endpoint>`

## Run and test

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then:

1. Click **Test server health**
2. Mint key
3. Activate key
4. Change device signature and retry to verify device limit

## Curl test flow

```bash
curl -s http://localhost:3000/api/v1/health

curl -s -X POST http://localhost:3000/api/v1/dev/mint \
  -H "content-type: application/json" \
  -H "x-dev-mint-secret: $DEV_MINT_SECRET" \
  -d '{"email":"demo@openreply.local","password":"demo123","max_devices":1}'

curl -s -X POST http://localhost:3000/api/v1/device/activate \
  -H "content-type: application/json" \
  -d '{"email":"demo@openreply.local","password":"demo123","activation_key":"PASTE_KEY","device_signature":"device-a","app":"openreply-desktop","os":"macos","arch":"aarch64"}'

curl -s http://localhost:3000/v1/health
```
