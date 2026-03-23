alter table public.claims
  add column if not exists hod_action_at timestamptz,
  add column if not exists finance_action_at timestamptz;

-- Backfill only when we can infer milestone ownership safely from current state.
update public.claims
set
  hod_action_at = coalesce(
    hod_action_at,
    case
      when status = 'HOD approved - Awaiting finance approval'::public.claim_status then updated_at
      when status = 'Rejected'::public.claim_status and assigned_l2_approver_id is null then updated_at
      else null
    end
  ),
  finance_action_at = coalesce(
    finance_action_at,
    case
      when status in (
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ) then updated_at
      when status = 'Rejected'::public.claim_status and assigned_l2_approver_id is not null then updated_at
      else null
    end
  )
where is_active = true;

drop view if exists public.vw_enterprise_claims_dashboard;

create view public.vw_enterprise_claims_dashboard as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(u.full_name), ''),
    nullif(trim(split_part(u.email, '@', 1)), ''),
    nullif(trim(c.employee_id), ''),
    nullif(trim(c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(c.employee_id), ''),
    nullif(trim(c.on_behalf_employee_code), ''),
    nullif(trim(c.on_behalf_email), ''),
    nullif(trim(u.email), ''),
    'N/A'
  ) as employee_id,
  coalesce(nullif(trim(md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = 'Rejected'::public.claim_status and c.assigned_l2_approver_id is null then c.updated_at
      else null
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status in (
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ) then c.updated_at
      when c.status = 'Rejected'::public.claim_status and c.assigned_l2_approver_id is not null then c.updated_at
      else null
    end
  ) as finance_action_date,
  c.submitted_by,
  c.on_behalf_of_id,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at
from public.claims c
left join public.users u
  on u.id = c.submitted_by
left join public.master_departments md
  on md.id = c.department_id
left join public.master_payment_modes mpm
  on mpm.id = c.payment_mode_id
left join public.expense_details ed
  on ed.claim_id = c.id
  and ed.is_active = true
left join public.advance_details ad
  on ad.claim_id = c.id
  and ad.is_active = true
where c.is_active = true;

create index if not exists idx_claims_dashboard_active_status_submitted
  on public.claims(status, submitted_at desc)
  where is_active = true;

create index if not exists idx_claims_dashboard_active_department_submitted
  on public.claims(department_id, submitted_at desc)
  where is_active = true;

create index if not exists idx_claims_dashboard_active_submitted
  on public.claims(submitted_at desc)
  where is_active = true;