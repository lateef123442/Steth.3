-- Private temporary storage for student-owned PDFs used only to generate CBT questions.
-- Files are removed by the app immediately after generation; no public access is granted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-practice', 'pdf-practice', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "Students upload their own practice PDFs" on storage.objects;
create policy "Students upload their own practice PDFs" on storage.objects for insert to authenticated
with check (bucket_id = 'pdf-practice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Students read their own practice PDFs" on storage.objects;
create policy "Students read their own practice PDFs" on storage.objects for select to authenticated
using (bucket_id = 'pdf-practice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Students delete their own practice PDFs" on storage.objects;
create policy "Students delete their own practice PDFs" on storage.objects for delete to authenticated
using (bucket_id = 'pdf-practice' and (storage.foldername(name))[1] = auth.uid()::text);
