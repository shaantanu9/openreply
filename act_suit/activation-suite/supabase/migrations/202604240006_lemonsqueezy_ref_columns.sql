-- Persist Lemon Squeezy external references on licences so the webhook can
-- correlate future events (renewals, cancellations) to the correct row, and
-- so /api/v1/billing/portal can mint a signed customer-portal URL.
--
-- All three columns are nullable — pre-webhook and trial licences stay NULL.

alter table public.licenses
  add column if not exists lemonsqueezy_customer_id     text null,
  add column if not exists lemonsqueezy_order_id        text null,
  add column if not exists lemonsqueezy_subscription_id text null;

-- Uniqueness on the two Lemon Squeezy ref columns prevents double-processing
-- when LS retries a webhook delivery.
create unique index if not exists idx_licenses_ls_order
  on public.licenses(lemonsqueezy_order_id)
  where lemonsqueezy_order_id is not null;

create unique index if not exists idx_licenses_ls_subscription
  on public.licenses(lemonsqueezy_subscription_id)
  where lemonsqueezy_subscription_id is not null;

create index if not exists idx_licenses_ls_customer
  on public.licenses(lemonsqueezy_customer_id)
  where lemonsqueezy_customer_id is not null;
