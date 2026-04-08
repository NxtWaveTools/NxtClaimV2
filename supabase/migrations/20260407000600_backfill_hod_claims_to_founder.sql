-- Migration: Backfill claims where beneficiary was department HOD and claim self-routed to HOD.
-- Scope: Historical data correction for L1 assignment to prevent HOD self-approval.

update public.claims as c
set assigned_l1_approver_id = md.founder_user_id
from public.master_departments as md
where c.department_id = md.id
  and coalesce(c.on_behalf_of_id, c.submitted_by) = md.hod_user_id
  and c.assigned_l1_approver_id = md.hod_user_id;

-- Rollback (manual)
-- There is no deterministic rollback without a point-in-time backup because prior
-- assigned_l1_approver_id values are overwritten in-place.
