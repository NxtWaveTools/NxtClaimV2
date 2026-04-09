-- Master optimization indexes for FK coverage and dashboard query performance.
-- Uses CONCURRENTLY + IF NOT EXISTS for zero-downtime index rollout.

-- P0: CRITICAL (Finance Dashboard Performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_assigned_l2_approver_id
ON public.claims USING btree (assigned_l2_approver_id);

-- P1: HIGH (Enterprise View & Reporting Joins)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_details_product_id
ON public.expense_details USING btree (product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advance_details_product_id
ON public.advance_details USING btree (product_id);

-- P2: MEDIUM (Audit History Lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claim_audit_logs_assigned_to_id
ON public.claim_audit_logs USING btree (assigned_to_id, created_at DESC);

-- P3: Pro-Level Composite (L1 Approver Dashboards)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_status_approver_submitted
ON public.claims USING btree (status, assigned_l1_approver_id, submitted_at DESC)
WHERE is_active = true;