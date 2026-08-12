-- =========================================================
-- SKEMA DATABASE "WhatsApp Clone" untuk Supabase
-- Jalankan file ini di Supabase Dashboard > SQL Editor
-- =========================================================

-- Ekstensi untuk uuid
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1. PROFILES (pengguna, cukup dengan username, tanpa login/password)
-- ---------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key default gen_random_uuid(),
  username     text unique not null,
  avatar_url   text,
  about        text default 'Halo! Saya menggunakan WhatsApp Clone.',
  is_online    boolean default false,
  last_seen    timestamptz default now(),
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------
-- 2. CHATS (percakapan, bisa 1-1 ataupun grup sederhana)
-- ---------------------------------------------------------
create table if not exists chats (
  id           uuid primary key default gen_random_uuid(),
  is_group     boolean default false,
  name         text,               -- dipakai kalau grup
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------
-- 3. CHAT_PARTICIPANTS (siapa saja ada di sebuah chat)
-- ---------------------------------------------------------
create table if not exists chat_participants (
  chat_id      uuid references chats(id) on delete cascade,
  profile_id   uuid references profiles(id) on delete cascade,
  joined_at    timestamptz default now(),
  primary key (chat_id, profile_id)
);

-- ---------------------------------------------------------
-- 4. MESSAGES (isi chat: teks, gambar, file, stiker)
-- ---------------------------------------------------------
create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid references chats(id) on delete cascade,
  sender_id    uuid references profiles(id) on delete cascade,
  type         text not null default 'text' check (type in ('text','image','file','sticker')),
  content      text,               -- isi pesan teks
  file_url     text,               -- url publik file/gambar/stiker di storage
  file_name    text,               -- nama asli file
  file_size    bigint,             -- ukuran file (bytes)
  created_at   timestamptz default now()
);

create index if not exists idx_messages_chat_id on messages(chat_id, created_at);

-- ---------------------------------------------------------
-- 5. STICKERS (stiker buatan pengguna sendiri)
-- ---------------------------------------------------------
create table if not exists stickers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references profiles(id) on delete cascade,
  image_url    text not null,
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------
-- 6. STATUSES / "Pembaruan" (status singkat, teks/gambar, ala story)
-- ---------------------------------------------------------
create table if not exists statuses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references profiles(id) on delete cascade,
  type         text not null default 'text' check (type in ('text','image')),
  content      text,
  image_url    text,
  created_at   timestamptz default now(),
  expires_at   timestamptz default (now() + interval '24 hours')
);

-- =========================================================
-- ROW LEVEL SECURITY
-- Catatan: proyek ini pakai "login" sederhana berbasis username
-- (bukan Supabase Auth), jadi policy dibuat permisif untuk role
-- anon/authenticated. Cukup untuk demo/belajar -- untuk produksi,
-- sebaiknya diganti dengan Supabase Auth + policy yang lebih ketat.
-- =========================================================
alter table profiles           enable row level security;
alter table chats              enable row level security;
alter table chat_participants  enable row level security;
alter table messages           enable row level security;
alter table stickers           enable row level security;
alter table statuses           enable row level security;

create policy "profiles: semua bisa baca"   on profiles   for select using (true);
create policy "profiles: semua bisa tulis"  on profiles   for insert with check (true);
create policy "profiles: semua bisa update" on profiles   for update using (true);

create policy "chats: semua bisa baca"      on chats      for select using (true);
create policy "chats: semua bisa tulis"     on chats      for insert with check (true);

create policy "participants: semua bisa baca"  on chat_participants for select using (true);
create policy "participants: semua bisa tulis" on chat_participants for insert with check (true);

create policy "messages: semua bisa baca"   on messages   for select using (true);
create policy "messages: semua bisa tulis"  on messages   for insert with check (true);

create policy "stickers: semua bisa baca"   on stickers   for select using (true);
create policy "stickers: semua bisa tulis"  on stickers   for insert with check (true);

create policy "statuses: semua bisa baca"   on statuses   for select using (true);
create policy "statuses: semua bisa tulis"  on statuses   for insert with check (true);

-- =========================================================
-- REALTIME: aktifkan replikasi untuk tabel pesan & status
-- =========================================================
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table statuses;
alter publication supabase_realtime add table profiles;

-- =========================================================
-- STORAGE BUCKETS: chat-media (gambar & file) dan stickers
-- =========================================================
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('stickers', 'stickers', true)
on conflict (id) do nothing;

create policy "chat-media: publik bisa baca"
  on storage.objects for select
  using (bucket_id = 'chat-media');

create policy "chat-media: publik bisa upload"
  on storage.objects for insert
  with check (bucket_id = 'chat-media');

create policy "stickers: publik bisa baca"
  on storage.objects for select
  using (bucket_id = 'stickers');

create policy "stickers: publik bisa upload"
  on storage.objects for insert
  with check (bucket_id = 'stickers');
