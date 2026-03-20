export type WalletSummaryTotals = {
  totalPettyCashReceived: number;
  totalPettyCashSpent: number;
  totalReimbursements: number;
  amountReceived: number;
  amountSpent: number;
  pettyCashBalance: number;
};

export type DashboardRepository = {
  getWalletTotals(userId: string): Promise<{
    data: {
      totalPettyCashReceived: number;
      totalPettyCashSpent: number;
      totalReimbursements: number;
      pettyCashBalance: number;
    } | null;
    errorMessage: string | null;
  }>;
};

export type DashboardDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};
