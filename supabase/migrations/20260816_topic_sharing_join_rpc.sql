-- Reliable invite join + member update policy.
-- Run after 20260816_topic_sharing_rls_fix.sql

create or replace function public.join_topic_share_by_token(p_token text)
returns public.topic_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.topic_shares;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Missing invite token';
  end if;

  select *
  into v_share
  from public.topic_shares
  where invite_token = trim(p_token)
    and status = 'open'
  limit 1;

  if v_share.id is null then
    raise exception 'This invite link is invalid or has expired.';
  end if;

  if v_share.owner_id = auth.uid() then
    raise exception 'This is your own share link.';
  end if;

  insert into public.topic_share_members (share_id, user_id, email)
  values (
    v_share.id,
    auth.uid(),
    lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  on conflict (share_id, user_id) do update
    set email = excluded.email;

  return v_share;
end;
$$;

revoke all on function public.join_topic_share_by_token(text) from public;
grant execute on function public.join_topic_share_by_token(text) to authenticated;

-- Allow upserts / re-joins for the same member
drop policy if exists "Users update own membership" on public.topic_share_members;
create policy "Users update own membership"
  on public.topic_share_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
