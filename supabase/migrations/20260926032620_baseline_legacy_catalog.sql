-- Matches the inspected MVP table without replacing existing records. This migration is
-- safe for the existing project as well as a fresh local database. New clients use the
-- versioned catalog in the next migration; this table remains a compatibility surface.
create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  annual_fee numeric not null default 0,
  rewards jsonb not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.update_updated_at_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.update_updated_at_column() from public, anon, authenticated;
drop trigger if exists update_credit_cards_updated_at on public.credit_cards;
create trigger update_credit_cards_updated_at before update on public.credit_cards
for each row execute function public.update_updated_at_column();

alter table public.credit_cards enable row level security;
drop policy if exists "Allow public read access to active cards" on public.credit_cards;
create policy "Allow public read access to active cards" on public.credit_cards
for select to anon, authenticated using (is_active = true);
-- RLS does not protect TRUNCATE: remove those legacy grants explicitly.
revoke all on public.credit_cards from public, anon, authenticated;
grant select on public.credit_cards to anon, authenticated;
