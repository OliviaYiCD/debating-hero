-- Fix infinite RLS recursion between topic_shares and topic_share_members.
-- Run this after 20260816_topic_sharing_link_invite.sql

create or replace function public.is_topic_share_owner(p_share_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_shares s
    where s.id = p_share_id
      and s.owner_id = auth.uid()
  );
$$;

create or replace function public.is_topic_share_member(p_share_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_share_members m
    where m.share_id = p_share_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_open_topic_share(p_share_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_shares s
    where s.id = p_share_id
      and s.status = 'open'
  );
$$;

create or replace function public.user_has_open_share_access(
  p_owner_id uuid,
  p_topic_id uuid,
  p_stance text,
  p_require_edit boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_shares s
    join public.topic_share_members m on m.share_id = s.id
    where s.owner_id = p_owner_id
      and s.topic_id = p_topic_id
      and s.stance = p_stance
      and s.status = 'open'
      and m.user_id = auth.uid()
      and (not p_require_edit or s.permission = 'edit')
  );
$$;

create or replace function public.user_has_open_share_on_custom_topic(p_topic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_shares s
    join public.topic_share_members m on m.share_id = s.id
    where s.topic_id = p_topic_id
      and s.topic_source = 'custom'
      and s.status = 'open'
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_topic_share_owner(uuid) from public;
revoke all on function public.is_topic_share_member(uuid) from public;
revoke all on function public.is_open_topic_share(uuid) from public;
revoke all on function public.user_has_open_share_access(uuid, uuid, text, boolean) from public;
revoke all on function public.user_has_open_share_on_custom_topic(uuid) from public;

grant execute on function public.is_topic_share_owner(uuid) to authenticated;
grant execute on function public.is_topic_share_member(uuid) to authenticated;
grant execute on function public.is_open_topic_share(uuid) to authenticated;
grant execute on function public.user_has_open_share_access(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.user_has_open_share_on_custom_topic(uuid) to authenticated;

-- Break the topic_shares <-> topic_share_members policy cycle
drop policy if exists "Owners read share members" on public.topic_share_members;
create policy "Owners read share members"
  on public.topic_share_members
  for select
  using (
    topic_share_members.user_id = auth.uid()
    or public.is_topic_share_owner(topic_share_members.share_id)
  );

drop policy if exists "Users join share links" on public.topic_share_members;
create policy "Users join share links"
  on public.topic_share_members
  for insert
  with check (
    auth.uid() = user_id
    and public.is_open_topic_share(share_id)
  );

drop policy if exists "Users leave shares" on public.topic_share_members;
create policy "Users leave shares"
  on public.topic_share_members
  for delete
  using (
    user_id = auth.uid()
    or public.is_topic_share_owner(share_id)
  );

drop policy if exists "Members read joined share links" on public.topic_shares;
create policy "Members read joined share links"
  on public.topic_shares
  for select
  using (public.is_topic_share_member(id));

-- Keep open-link reads (no cross-table subquery)
drop policy if exists "Authenticated users read open share links" on public.topic_shares;
create policy "Authenticated users read open share links"
  on public.topic_shares
  for select
  using (status = 'open' and auth.uid() is not null);

-- Debate / comments / custom topics: avoid recursive joins
drop policy if exists "Share members read shared debates" on public.user_debates;
create policy "Share members read shared debates"
  on public.user_debates
  for select
  using (
    public.user_has_open_share_access(
      user_debates.user_id,
      user_debates.topic_id,
      user_debates.stance,
      false
    )
  );

drop policy if exists "Share members edit shared debates" on public.user_debates;
create policy "Share members edit shared debates"
  on public.user_debates
  for all
  using (
    public.user_has_open_share_access(
      user_debates.user_id,
      user_debates.topic_id,
      user_debates.stance,
      true
    )
  )
  with check (
    public.user_has_open_share_access(
      user_debates.user_id,
      user_debates.topic_id,
      user_debates.stance,
      true
    )
  );

drop policy if exists "Share members read comments" on public.topic_point_comments;
create policy "Share members read comments"
  on public.topic_point_comments
  for select
  using (
    public.user_has_open_share_access(
      topic_point_comments.owner_id,
      topic_point_comments.topic_id,
      topic_point_comments.stance,
      false
    )
  );

drop policy if exists "Share members insert view comments" on public.topic_point_comments;
create policy "Share members insert view comments"
  on public.topic_point_comments
  for insert
  with check (
    auth.uid() = author_id
    and public.user_has_open_share_access(
      topic_point_comments.owner_id,
      topic_point_comments.topic_id,
      topic_point_comments.stance,
      false
    )
  );

drop policy if exists "Collaborators read shared custom topics via members" on public.user_topics;
create policy "Collaborators read shared custom topics via members"
  on public.user_topics
  for select
  using (public.user_has_open_share_on_custom_topic(user_topics.id));

notify pgrst, 'reload schema';
