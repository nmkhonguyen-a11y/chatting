-- CHATVERSE schema for Supabase
-- Run the entire file in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text unique not null,
  display_name text not null default 'Người dùng',
  created_at timestamptz not null default now()
);

create or replace function public.make_public_id()
returns text language sql volatile as $$
  select 'CV-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,8));
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, public_id, display_name)
  values (
    new.id,
    public.make_public_id(),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'Người dùng')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check(sender_id <> receiver_id)
);
create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_a,user_b),
  check(user_a <> user_b)
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists conversations_dm_name on public.conversations(name) where is_group = false;
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check(char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created on public.messages(conversation_id,created_at);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Profiles: signed-in users can find accounts by public ID.
drop policy if exists "profiles readable by signed in" on public.profiles;
create policy "profiles readable by signed in" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Friend requests
drop policy if exists "send friend requests" on public.friend_requests;
create policy "send friend requests" on public.friend_requests for insert to authenticated with check (sender_id = auth.uid());
drop policy if exists "view own friend requests" on public.friend_requests;
create policy "view own friend requests" on public.friend_requests for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
drop policy if exists "receiver updates request" on public.friend_requests;
create policy "receiver updates request" on public.friend_requests for update to authenticated using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

-- Friendships
drop policy if exists "friendship participants can read" on public.friendships;
create policy "friendship participants can read" on public.friendships for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());
drop policy if exists "users can create own friendship" on public.friendships;
create policy "users can create own friendship" on public.friendships for insert to authenticated with check (user_a = auth.uid() or user_b = auth.uid());

-- Conversations and members.
-- SECURITY DEFINER helper avoids recursive RLS when checking membership.
create or replace function public.is_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = _conversation_id and user_id = _user_id
  );
$$;

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations" on public.conversations for select to authenticated
using (public.is_conversation_member(id, auth.uid()));
drop policy if exists "signed in create conversations" on public.conversations;
create policy "signed in create conversations" on public.conversations for insert to authenticated
with check (created_by = auth.uid() or created_by is null);
drop policy if exists "members read membership" on public.conversation_members;
create policy "members read membership" on public.conversation_members for select to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "creator adds members" on public.conversation_members;
create policy "creator adds members" on public.conversation_members for insert to authenticated
with check (exists(select 1 from public.conversations c where c.id=conversation_id and (c.created_by=auth.uid() or c.created_by is null)));

-- Messages
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages for select to authenticated
using (exists(select 1 from public.conversation_members m where m.conversation_id=conversation_id and m.user_id=auth.uid()));
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated
with check (user_id=auth.uid() and exists(select 1 from public.conversation_members m where m.conversation_id=conversation_id and m.user_id=auth.uid()));

-- Enable realtime updates for messages.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

-- Private voice signaling authorization:
-- Realtime channel topic is voice:<conversation UUID>.
-- Only users who belong to that conversation may receive/send signaling events.
drop policy if exists "conversation members can use voice channels" on realtime.messages;
create policy "conversation members can use voice channels"
on realtime.messages
for all
to authenticated
using (
  realtime.topic() like 'voice:%'
  and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = split_part(realtime.topic(), ':', 2)::uuid
      and m.user_id = auth.uid()
  )
)
with check (
  realtime.topic() like 'voice:%'
  and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = split_part(realtime.topic(), ':', 2)::uuid
      and m.user_id = auth.uid()
  )
);
