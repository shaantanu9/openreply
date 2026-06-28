# Enterprise daily brief + action loop (site/app sync layer)

## Summary

Implemented the daily activity foundation in `activation-suite` so enterprise-style
execution can run inside each workspace:

- New **daily brief API** (top/rising gaps + 24h insight summary)
- New **enterprise actions API** (create/list/update/delete action items)
- Workspace UI now has an **Activity** tab with:
  - daily brief metrics
  - rising gaps preview
  - action queue management
- Added migration for `enterprise_actions` with RLS and indexes.

## Added

- `act_suit/activation-suite/supabase/migrations/202604270007_enterprise_actions.sql`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/daily-brief/route.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/actions/route.ts`
- `act_suit/activation-suite/src/app/api/v1/workspaces/[id]/actions/[actionId]/route.ts`

## Changed

- `act_suit/activation-suite/src/lib/community/types.ts`
  - Added `DailyBrief`, `EnterpriseAction`, status/priority types.
- `act_suit/activation-suite/src/lib/community/workspaces.ts`
  - Added daily brief builder and enterprise action data methods.
- `act_suit/activation-suite/src/lib/community/communityClient.ts`
  - Added client methods for daily brief and enterprise actions.
- `act_suit/activation-suite/src/components/workspaces/WorkspaceDetailPanel.tsx`
  - Added `activity` tab and action management UI.

## Verification

- `npm run build` (activation-suite) passed.
- Lint diagnostics for touched files: no issues.

