# Community App Foundation (dual-app spec)

**Date:** 2026-04-24
**Type:** Feature + Infrastructure

## Summary

First pass at implementing the Community half of
`docs/licence/gapmap-dual-app-spec.md`. The Next.js `activation-suite` now
carries the full research-publishing surface — DB schema, server libs, API
routes, and UI pages — for workspaces, sweeps, insights, publishing, the
public explore feed, and profiles. Source-connector fetching and AI
extraction are stubbed (clearly labelled) since those still need the real
Rust core crate from spec §3 Phase 1.

## Changes

- Supabase migration `202604240005_community_schema.sql` with 10 tables,
  RLS, auto-profile trigger, research-count trigger.
- `src/lib/community/` — types, slug helper, BYOK encryption
  (PBKDF2+AES-GCM), workspace CRUD, publish snapshot builder, sweep engine
  stub, `routeAuth` helper, browser `communityClient`.
- API routes in `src/app/api/v1/`:
  `workspaces`, `workspaces/[id]`, `workspaces/[id]/sources`,
  `workspaces/[id]/sources/[sourceId]`, `sweep`, `sweep/[id]`, `insights`,
  `publish`, `unpublish`, `byok`, `profiles/[username]`.
- UI pages:
  `/workspaces` (list + create), `/workspaces/[id]` (tabs: ingest / sweep /
  insights / report / settings with markdown+CSV export),
  `/explore` (ISR 10-min feed), `/explore/[slug]` (ISR 1h research detail),
  `/u/[username]` (public researcher profile),
  `/settings/byok`, `/settings/profile`.
- `ROUTES` gains workspaces/explore/settings/profile entries.
- `UserMenu` surfaces the new entries.

## Files Created

- `act_suit/activation-suite/supabase/migrations/202604240005_community_schema.sql`
- `act_suit/activation-suite/src/lib/community/types.ts`
- `act_suit/activation-suite/src/lib/community/slug.ts`
- `act_suit/activation-suite/src/lib/community/byok.ts`
- `act_suit/activation-suite/src/lib/community/workspaces.ts`
- `act_suit/activation-suite/src/lib/community/publish.ts`
- `act_suit/activation-suite/src/lib/community/sweepEngine.ts`
- `act_suit/activation-suite/src/lib/community/routeAuth.ts`
- `act_suit/activation-suite/src/lib/community/communityClient.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/route.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/route.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/sources/route.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/sources/[sourceId]/route.ts`
- `act_suit/activation-suite/src/app/api/v1/sweep/route.ts`
- `act_suit/activation-suite/src/app/api/v1/sweep/[id]/route.ts`
- `act_suit/activation-suite/src/app/api/v1/insights/route.ts`
- `act_suit/activation-suite/src/app/api/v1/publish/route.ts`
- `act_suit/activation-suite/src/app/api/v1/unpublish/route.ts`
- `act_suit/activation-suite/src/app/api/v1/byok/route.ts`
- `act_suit/activation-suite/src/app/api/v1/profiles/[username]/route.ts`
- `act_suit/activation-suite/src/app/workspaces/page.tsx`
- `act_suit/activation-suite/src/components/workspaces/WorkspacesPanel.tsx`
- `act_suit/activation-suite/src/app/workspaces/[id]/page.tsx`
- `act_suit/activation-suite/src/components/workspaces/WorkspaceDetailPanel.tsx`
- `act_suit/activation-suite/src/app/explore/page.tsx`
- `act_suit/activation-suite/src/app/explore/[slug]/page.tsx`
- `act_suit/activation-suite/src/app/u/[username]/page.tsx`
- `act_suit/activation-suite/src/app/settings/byok/page.tsx`
- `act_suit/activation-suite/src/components/settings/ByokPanel.tsx`
- `act_suit/activation-suite/src/app/settings/profile/page.tsx`
- `act_suit/activation-suite/src/components/settings/ProfileSettingsPanel.tsx`

## Files Modified

- `act_suit/activation-suite/src/lib/constants.ts` — new ROUTES entries.
- `act_suit/activation-suite/src/components/shell/UserMenu.tsx` — Workspaces /
  Explore / BYOK / Profile links.

## Stubs (needs production follow-up)

- `sweepEngine.ts` generates mock posts and insights. Replace with the
  shared Rust core engine from spec §3 / Phase 1 (real Reddit / HN / G2
  connectors + BYOK AI extraction).
- BYOK key is encrypted with the user's Gap Map password. The password
  itself isn't stored — Supabase Auth stores a bcrypt hash. If a user forgets
  their password, their keys are unrecoverable (documented in the UI).
- PDF export is stubbed as "Pro-only" in the report tab; CSV + Markdown ship
  today and download client-side.
- The Pro-bridge endpoint (`/api/v1/pro/publish` per spec §6.3) is not yet
  implemented — Community-side publish works, the anonymous Pro-bridge path
  is a follow-up once the Pro app needs it.
