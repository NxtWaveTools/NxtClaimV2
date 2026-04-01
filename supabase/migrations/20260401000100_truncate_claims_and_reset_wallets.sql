-- ============================================================
-- Data Reset: Truncate all claim-related data and zero wallets
-- WARNING: DESTRUCTIVE — no rollback. Non-production only.
-- ============================================================

BEGIN; -- Start the transaction

-- 1. Wipe Claims and all dependencies
TRUNCATE TABLE public.claims CASCADE;

-- 2. Zero out every wallet
UPDATE public.wallets
SET
  total_reimbursements_received = 0.00,
  total_petty_cash_received     = 0.00,
  total_petty_cash_spent        = 0.00,
  petty_cash_balance            = 0.00,
  updated_at                    = now();

COMMIT; -- Apply the changes permanently