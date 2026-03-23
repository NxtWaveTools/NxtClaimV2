alter table public.claims
  add column if not exists rejection_reason text;

alter table public.claims
  add column if not exists is_resubmission_allowed boolean not null default false;

alter table public.expense_details
  drop constraint if exists uq_expense_details_bill_date_total_amount;

drop index if exists public.uq_expense_details_active_bill;

create unique index uq_expense_details_active_bill
  on public.expense_details (bill_no, transaction_date, total_amount)
  where is_active = true;

-- Rollback guidance (execute manually when safe):
-- 1) drop index if exists public.uq_expense_details_active_bill;
-- 2) alter table public.expense_details add constraint uq_expense_details_bill_date_total_amount
--      unique (bill_no, transaction_date, total_amount);
-- 3) alter table public.claims drop column if exists is_resubmission_allowed;
