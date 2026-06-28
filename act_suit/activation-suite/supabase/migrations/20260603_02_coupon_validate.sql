-- Non-consuming coupon validation for the invite-only beta gate.
--
-- redeem_coupon() (migration 202605250008) INCREMENTS the counter, so it can't
-- be used to check a code at sign-up (the account might not complete). This
-- adds a read-only validate that also returns seat scarcity for the FOMO UI.

create or replace function public.validate_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.coupons;
  e text := upper(trim(p_code));
begin
  if e is null or e = '' then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  select * into v from public.coupons where code = e;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v.disabled then
    return jsonb_build_object('valid', false, 'reason', 'disabled');
  end if;
  if v.expires_at is not null and v.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  if v.max_redemptions is not null and v.current_redemptions >= v.max_redemptions then
    return jsonb_build_object('valid', false, 'reason', 'exhausted');
  end if;

  return jsonb_build_object(
    'valid', true,
    'reason', 'ok',
    'code', v.code,
    'plan_id', v.plan_id,
    'seats_total', v.max_redemptions,                                   -- null = unlimited
    'seats_left', case when v.max_redemptions is null then null
                       else v.max_redemptions - v.current_redemptions end,
    'seats_claimed', v.current_redemptions
  );
end;
$$;

grant execute on function public.validate_coupon(text) to anon, authenticated, service_role;

-- Seed the founding-beta invite (idempotent). 100 seats, pro plan, 2 devices.
insert into public.coupons (code, plan_id, max_redemptions, license_max_devices, note)
  values ('OPENREPLY-BETA-2026', 'pro', 100, 2, 'Founding beta cohort — invite-only FOMO gate')
  on conflict (code) do nothing;
