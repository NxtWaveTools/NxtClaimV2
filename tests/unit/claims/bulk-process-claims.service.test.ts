import { BulkProcessClaimsService } from "@/core/domain/claims/BulkProcessClaimsService";
import type { GetMyClaimsFilters } from "@/core/domain/claims/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(
  overrides?: Partial<{
    getFinanceApproverIdsForUser: (
      userId: string,
    ) => Promise<{ data: string[]; errorMessage: string | null }>;
    listFinancePendingApprovalIds: (
      userId: string,
      filters?: Record<string, unknown>,
    ) => Promise<{ data: string[]; errorMessage: string | null }>;
    bulkProcessClaims: (input: {
      claimIds: string[];
      action: "L2_APPROVE" | "L2_REJECT" | "MARK_PAID";
      actorUserId: string;
      reason?: string;
    }) => Promise<{ processedCount: number; errorMessage: string | null }>;
  }>,
) {
  return {
    getFinanceApproverIdsForUser: jest.fn(async () => ({
      data: ["finance-approver-1"],
      errorMessage: null,
    })),
    listFinancePendingApprovalIds: jest.fn(async () => ({
      data: ["CLM-001", "CLM-002", "CLM-003"],
      errorMessage: null,
    })),
    bulkProcessClaims: jest.fn(async () => ({ processedCount: 3, errorMessage: null })),
    ...(overrides ?? {}),
  };
}

describe("BulkProcessClaimsService", () => {
  test("uses explicit claim ids when global selection is disabled", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new BulkProcessClaimsService({ repository, logger });

    const result = await service.execute({
      actorUserId: "finance-user-id",
      action: "L2_APPROVE",
      claimIds: ["CLM-010", "CLM-011", "CLM-010"],
      isGlobalSelect: false,
    });

    expect(result).toEqual({ ok: true, processedCount: 3, errorMessage: null });
    expect(repository.listFinancePendingApprovalIds).not.toHaveBeenCalled();
    expect(repository.bulkProcessClaims).toHaveBeenCalledWith({
      claimIds: ["CLM-010", "CLM-011"],
      action: "L2_APPROVE",
      actorUserId: "finance-user-id",
      reason: undefined,
    });
  });

  test("resolves all matching claim ids when global selection is enabled", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new BulkProcessClaimsService({ repository, logger });

    const filters: GetMyClaimsFilters = {
      status: ["HOD approved - Awaiting finance approval"],
      searchField: "employee_id",
      searchQuery: "EMP-100",
    };

    const result = await service.execute({
      actorUserId: "finance-user-id",
      action: "L2_REJECT",
      claimIds: ["ONLY-PAGE-ID"],
      isGlobalSelect: true,
      filters,
      reason: "Shared rejection reason",
    });

    expect(result.ok).toBe(true);
    expect(repository.listFinancePendingApprovalIds).toHaveBeenCalledWith(
      "finance-user-id",
      filters,
    );
    expect(repository.bulkProcessClaims).toHaveBeenCalledWith({
      claimIds: ["CLM-001", "CLM-002", "CLM-003"],
      action: "L2_REJECT",
      actorUserId: "finance-user-id",
      reason: "Shared rejection reason",
    });
  });

  test("rejects non-finance actors before touching bulk RPC", async () => {
    const repository = createRepository({
      getFinanceApproverIdsForUser: jest.fn(async () => ({ data: [], errorMessage: null })),
    });
    const logger = createLogger();
    const service = new BulkProcessClaimsService({ repository, logger });

    const result = await service.execute({
      actorUserId: "employee-user-id",
      action: "MARK_PAID",
      claimIds: ["CLM-999"],
      isGlobalSelect: false,
    });

    expect(result).toEqual({
      ok: false,
      processedCount: 0,
      errorMessage: "Only Finance users can run bulk claim actions.",
    });
    expect(repository.bulkProcessClaims).not.toHaveBeenCalled();
  });
});
