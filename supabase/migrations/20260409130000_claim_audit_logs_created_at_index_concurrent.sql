-- Improve audit-history reads that sort globally by created_at.
-- Existing composite coverage is already present via:
--   public.idx_claim_audit_logs_claim_created_at (claim_id, created_at)
-- Avoid creating a duplicate composite index under a different name.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claim_audit_logs_created_at
ON public.claim_audit_logs USING btree (created_at);

-- Rollback (if needed):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_claim_audit_logs_created_at;