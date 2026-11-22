-- 053: private student-owned reading materials for Study with a Timer.
-- Students can upload any file they want to read; files are never public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-materials', 'study-materials', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  file_name text not null check (char_length(trim(file_name)) between 1 and 240),
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null check (file_size between 1 and 52428800),
  created_at timestamptz not null default now(),
  check (left(storage_path, char_length(owner_id::text) + 1) = owner_id::text || '/')
);

create index if not exists idx_study_materials_owner_created on public.study_materials(owner_id, created_at desc);
alter table public.study_materials enable row level security;
drop policy if exists "students manage own study materials" on public.study_materials;
create policy "students manage own study materials" on public.study_materials
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.study_materials from anon;
grant select, insert, delete on public.study_materials to authenticated;

-- Storage object paths begin with the uploader's profile UUID.
drop policy if exists "study materials upload own" on storage.objects;
drop policy if exists "study materials read own" on storage.objects;
drop policy if exists "study materials delete own" on storage.objects;
create policy "study materials upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "study materials read own" on storage.objects for select to authenticated
  using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "study materials delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);
