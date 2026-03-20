create extension if not exists pgcrypto;

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete restrict,
  total_reimbursements_received numeric(14,2) not null default 0.00,
  total_petty_cash_received numeric(14,2) not null default 0.00,
  total_petty_cash_spent numeric(14,2) not null default 0.00,
  petty_cash_balance numeric(14,2) not null default 0.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_total_reimbursements_non_negative check (total_reimbursements_received >= 0),
  constraint wallets_total_petty_cash_received_non_negative check (total_petty_cash_received >= 0),
  constraint wallets_total_petty_cash_spent_non_negative check (total_petty_cash_spent >= 0),
  constraint wallets_petty_cash_balance_non_negative check (petty_cash_balance >= 0),
  constraint wallets_petty_cash_balance_consistency check (
    petty_cash_balance = total_petty_cash_received - total_petty_cash_spent
  )
);

create index if not exists idx_wallets_updated_at on public.wallets(updated_at);

create or replace function public.wallets_set_derived_fields()
returns trigger
language plpgsql
as $$
begin
  new.total_reimbursements_received := coalesce(new.total_reimbursements_received, 0.00);
  new.total_petty_cash_received := coalesce(new.total_petty_cash_received, 0.00);
  new.total_petty_cash_spent := coalesce(new.total_petty_cash_spent, 0.00);
  new.petty_cash_balance := new.total_petty_cash_received - new.total_petty_cash_spent;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_wallets_set_derived_fields on public.wallets;
create trigger trg_wallets_set_derived_fields
before insert or update on public.wallets
for each row
execute function public.wallets_set_derived_fields();

alter table public.wallets enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'wallets'
      and policyname = 'users can read own wallet'
  ) then
    create policy "users can read own wallet"
      on public.wallets
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'wallets'
      and policyname = 'finance can insert wallets'
  ) then
    create policy "finance can insert wallets"
      on public.wallets
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'wallets'
      and policyname = 'finance can update wallets'
  ) then
    create policy "finance can update wallets"
      on public.wallets
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      )
      with check (
        exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      );
  end if;
end
$$;

insert into public.wallets (
  user_id,
  total_reimbursements_received,
  total_petty_cash_received,
  total_petty_cash_spent,
  petty_cash_balance
)
select
  u.id,
  0.00,
  0.00,
  0.00,
  0.00
from public.users u
on conflict (user_id)
do update set
  total_reimbursements_received = coalesce(public.wallets.total_reimbursements_received, 0.00),
  total_petty_cash_received = coalesce(public.wallets.total_petty_cash_received, 0.00),
  total_petty_cash_spent = coalesce(public.wallets.total_petty_cash_spent, 0.00),
  updated_at = now();