-- Anti-abuse: cap how many invite emails we ever send to one address. Without
-- this, someone could re-submit the homepage form repeatedly and make us email
-- a target (or themselves) unbounded times, burning our Resend quota / reputation.

alter table public.waitlist add column if not exists invite_sends int not null default 0;

-- Atomic increment; returns the new count so the route can enforce the cap.
create or replace function public.increment_waitlist_send(p_email text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.waitlist
    set invite_sends = coalesce(invite_sends, 0) + 1
    where lower(email) = lower(trim(p_email))
    returning invite_sends into n;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.increment_waitlist_send(text) from public, anon, authenticated;
grant execute on function public.increment_waitlist_send(text) to service_role;
