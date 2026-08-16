-- Topic collaboration shares (Miro/Figma-style)
-- Run this in the Supabase SQL Editor for project lnrwbebovvtknsbmzerc

create extension if not exists pgcrypto;

create table if not exists public.topic_shares (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null,
  topic_source text not null check (topic_source in ('library', 'custom')),
  topic_title text not null default '',
  owner_id uuid not null references auth.users (id) on delete cascade,
  stance text not null check (stance in ('Affirmative', 'Negative')),
  shared_with_email text,
  shared_with_user_id uuid references auth.users (id) on delete set null,
  permission text not null check (permission in ('view', 'edit')),
  invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'open' check (status in ('pending', 'accepted', 'revoked', 'open')),
  created_at timestamptz not null default now(),
  unique (topic_id, owner_id, stance, shared_with_email)
);

create index if not exists topic_shares_email_idx
  on public.topic_shares (lower(shared_with_email));

create index if not exists topic_shares_user_idx
  on public.topic_shares (shared_with_user_id);

create index if not exists topic_shares_owner_idx
  on public.topic_shares (owner_id);

create table if not exists public.topic_point_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  topic_id uuid not null,
  stance text not null check (stance in ('Affirmative', 'Negative')),
  target_key text not null,
  body text not null,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists topic_point_comments_doc_idx
  on public.topic_point_comments (owner_id, topic_id, stance, target_key);

alter table public.topic_shares enable row level security;
alter table public.topic_point_comments enable row level security;

-- Owners manage their shares
drop policy if exists "Owners manage topic shares" on public.topic_shares;
create policy "Owners manage topic shares"
  on public.topic_shares
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Recipients can read shares emailed to them or linked to their user id
drop policy if exists "Recipients read topic shares" on public.topic_shares;
create policy "Recipients read topic shares"
  on public.topic_shares
  for select
  using (
    auth.uid() = shared_with_user_id
    or lower(shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Recipients can accept a pending invite (link their user id)
drop policy if exists "Recipients accept topic shares" on public.topic_shares;
create policy "Recipients accept topic shares"
  on public.topic_shares
  for update
  using (
    lower(shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or auth.uid() = shared_with_user_id
  )
  with check (
    lower(shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or auth.uid() = shared_with_user_id
  );

-- Anyone with access (owner or accepted share) can read owner's debate row
drop policy if exists "Collaborators read shared debates" on public.user_debates;
create policy "Collaborators read shared debates"
  on public.user_debates
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.topic_shares s
      where s.owner_id = user_debates.user_id
        and s.topic_id = user_debates.topic_id
        and s.stance = user_debates.stance
        and s.status = 'accepted'
        and (
          s.shared_with_user_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

-- Edit collaborators can upsert owner's debate
drop policy if exists "Collaborators edit shared debates" on public.user_debates;
create policy "Collaborators edit shared debates"
  on public.user_debates
  for all
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.topic_shares s
      where s.owner_id = user_debates.user_id
        and s.topic_id = user_debates.topic_id
        and s.stance = user_debates.stance
        and s.permission = 'edit'
        and s.status = 'accepted'
        and (
          s.shared_with_user_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.topic_shares s
      where s.owner_id = user_debates.user_id
        and s.topic_id = user_debates.topic_id
        and s.stance = user_debates.stance
        and s.permission = 'edit'
        and s.status = 'accepted'
        and (
          s.shared_with_user_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

-- Comments: owner + anyone with accepted access can read
drop policy if exists "Read topic point comments" on public.topic_point_comments;
create policy "Read topic point comments"
  on public.topic_point_comments
  for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1
      from public.topic_shares s
      where s.owner_id = topic_point_comments.owner_id
        and s.topic_id = topic_point_comments.topic_id
        and s.stance = topic_point_comments.stance
        and s.status = 'accepted'
        and (
          s.shared_with_user_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

-- View-only (and owners) can insert comments
drop policy if exists "Insert topic point comments" on public.topic_point_comments;
create policy "Insert topic point comments"
  on public.topic_point_comments
  for insert
  with check (
    auth.uid() = author_id
    and (
      auth.uid() = owner_id
      or exists (
        select 1
        from public.topic_shares s
        where s.owner_id = topic_point_comments.owner_id
          and s.topic_id = topic_point_comments.topic_id
          and s.stance = topic_point_comments.stance
          and s.status = 'accepted'
          and s.permission = 'view'
          and (
            s.shared_with_user_id = auth.uid()
            or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
    )
  );

-- Authors can delete their own comments
drop policy if exists "Authors delete own comments" on public.topic_point_comments;
create policy "Authors delete own comments"
  on public.topic_point_comments
  for delete
  using (auth.uid() = author_id or auth.uid() = owner_id);

-- Allow collaborators to read shared custom topics
drop policy if exists "Collaborators read shared custom topics" on public.user_topics;
create policy "Collaborators read shared custom topics"
  on public.user_topics
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.topic_shares s
      where s.topic_id = user_topics.id
        and s.topic_source = 'custom'
        and s.status in ('pending', 'accepted')
        and (
          s.shared_with_user_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

notify pgrst, 'reload schema';
