import type {
  ClaimDomainLogger,
  ClaimFullExportRecord,
  ClaimsExportFetchScope,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";

type ExportClaimsRepository = {
  getApprovalViewerContext(userId: string): Promise<{
    data: { isHod: boolean; isFounder: boolean; isFinance: boolean };
    errorMessage: string | null;
  }>;
  getClaimsForFullExport(input: {
    userId: string;
    fetchScope: ClaimsExportFetchScope;
    filters?: GetMyClaimsFilters;
    limit: number;
    offset: number;
  }): Promise<{ data: ClaimFullExportRecord[]; errorMessage: string | null }>;
  getClaimEvidencePublicUrl(input: {
    filePath: string;
  }): Promise<{ data: string | null; errorMessage: string | null }>;
};

type ExportClaimsServiceDependencies = {
  repository: ExportClaimsRepository;
  logger: ClaimDomainLogger;
};

type ExportClaimsServiceInput = {
  userId: string;
  scope: "submissions" | "approvals";
  filters?: GetMyClaimsFilters;
};

type ExportClaimsServiceResult = {
  csvData: string;
  fileName: string;
  rowCount: number;
  errorMessage: string | null;
};

const EXPORT_BATCH_SIZE = 500;

const CSV_HEADERS = [
  "Claim ID",
  "Status",
  "Submission Type",
  "Detail Type",
  "Submitted At (Raw)",
  "Submitted At (Formatted)",
  "Created At (Raw)",
  "Created At (Formatted)",
  "Updated At (Raw)",
  "Updated At (Formatted)",
  "HOD Action At (Raw)",
  "HOD Action At (Formatted)",
  "Finance Action At (Raw)",
  "Finance Action At (Formatted)",
  "Rejection Reason",
  "Is Resubmission Allowed",
  "Employee ID",
  "CC Emails",
  "On Behalf Email",
  "On Behalf Employee Code",
  "Submitted By User ID",
  "On Behalf Of User ID",
  "Submitter Name",
  "Submitter Email",
  "Beneficiary Name",
  "Beneficiary Email",
  "Department ID",
  "Department",
  "Payment Mode ID",
  "Payment Mode",
  "Assigned L1 Approver ID",
  "Assigned L2 Approver ID",
  "L1 Approver Name",
  "L1 Approver Email",
  "L2 Approver Name",
  "L2 Approver Email",
  "Expense Bill No",
  "Expense Transaction ID",
  "Expense Date",
  "Expense Date (Formatted)",
  "Expense Category ID",
  "Expense Category",
  "Expense Product ID",
  "Expense Product",
  "Expense Location ID",
  "Expense Location",
  "Purpose",
  "GST Applicable",
  "GST Number",
  "Basic Amount (Raw)",
  "Basic Amount (Formatted)",
  "CGST Amount (Raw)",
  "CGST Amount (Formatted)",
  "SGST Amount (Raw)",
  "SGST Amount (Formatted)",
  "IGST Amount (Raw)",
  "IGST Amount (Formatted)",
  "Total Amount (Raw)",
  "Total Amount (Formatted)",
  "Currency",
  "Vendor Name",
  "People Involved",
  "Expense Remarks",
  "Receipt Name",
  "Receipt File Path",
  "Receipt URL",
  "Bank Statement Name",
  "Bank Statement File Path",
  "Bank Statement URL",
  "Advance Requested Amount (Raw)",
  "Advance Requested Amount (Formatted)",
  "Advance Budget Month",
  "Advance Budget Year",
  "Advance Expected Usage Date (Raw)",
  "Advance Expected Usage Date (Formatted)",
  "Advance Purpose",
  "Advance Product ID",
  "Advance Product",
  "Advance Location ID",
  "Advance Location",
  "Advance Remarks",
  "Supporting Document Name",
  "Supporting Document Path",
  "Supporting Document URL",
] as const;

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const stringValue = value == null ? "" : String(value);

  if (
    stringValue.includes('"') ||
    stringValue.includes(",") ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function buildCsvRow(values: Array<string | number | boolean | null | undefined>): string {
  return values.map((value) => escapeCsvValue(value)).join(",");
}

function formatDateDisplay(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  const seconds = String(parsed.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

function formatAmountDisplay(value: number | null): string {
  if (value == null) {
    return "";
  }

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toRawAmount(value: number | null): string {
  if (value == null) {
    return "";
  }

  return value.toFixed(2);
}

function toBooleanCsv(value: boolean | null): string {
  if (value == null) {
    return "";
  }

  return value ? "Yes" : "No";
}

function resolveExportScope(
  input: ExportClaimsServiceInput,
  viewerContext: { isHod: boolean; isFounder: boolean; isFinance: boolean },
): ClaimsExportFetchScope | null {
  if (input.scope === "submissions") {
    return "submissions";
  }

  if (viewerContext.isFinance) {
    return "finance_approvals";
  }

  if (viewerContext.isHod || viewerContext.isFounder) {
    return "l1_approvals";
  }

  return null;
}

function resolveFilenameDateTag(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function extractFileName(filePath: string | null): string {
  if (!filePath) {
    return "";
  }

  const normalized = filePath.replace(/\\/g, "/");
  const name = normalized.split("/").pop();
  return name ?? "";
}

export class ExportClaimsService {
  private readonly repository: ExportClaimsRepository;
  private readonly logger: ClaimDomainLogger;

  constructor(deps: ExportClaimsServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async execute(input: ExportClaimsServiceInput): Promise<ExportClaimsServiceResult> {
    const viewerContextResult = await this.repository.getApprovalViewerContext(input.userId);

    if (viewerContextResult.errorMessage) {
      return {
        csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
        fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
        rowCount: 0,
        errorMessage: viewerContextResult.errorMessage,
      };
    }

    const fetchScope = resolveExportScope(input, viewerContextResult.data);

    if (!fetchScope) {
      return {
        csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
        fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
        rowCount: 0,
        errorMessage: null,
      };
    }

    const rows: ClaimFullExportRecord[] = [];
    let offset = 0;

    while (true) {
      const batchResult = await this.repository.getClaimsForFullExport({
        userId: input.userId,
        fetchScope,
        filters: input.filters,
        limit: EXPORT_BATCH_SIZE,
        offset,
      });

      if (batchResult.errorMessage) {
        return {
          csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
          fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
          rowCount: 0,
          errorMessage: batchResult.errorMessage,
        };
      }

      if (batchResult.data.length === 0) {
        break;
      }

      rows.push(...batchResult.data);

      if (batchResult.data.length < EXPORT_BATCH_SIZE) {
        break;
      }

      offset += EXPORT_BATCH_SIZE;
    }

    const csvLines: string[] = [buildCsvRow([...CSV_HEADERS])];

    for (const row of rows) {
      const receiptUrlResult = row.expenseReceiptFilePath
        ? await this.repository.getClaimEvidencePublicUrl({ filePath: row.expenseReceiptFilePath })
        : { data: null, errorMessage: null };
      const bankStatementUrlResult = row.expenseBankStatementFilePath
        ? await this.repository.getClaimEvidencePublicUrl({
            filePath: row.expenseBankStatementFilePath,
          })
        : { data: null, errorMessage: null };
      const supportingUrlResult = row.advanceSupportingDocumentPath
        ? await this.repository.getClaimEvidencePublicUrl({
            filePath: row.advanceSupportingDocumentPath,
          })
        : { data: null, errorMessage: null };

      if (
        receiptUrlResult.errorMessage ||
        bankStatementUrlResult.errorMessage ||
        supportingUrlResult.errorMessage
      ) {
        this.logger.warn("claims.export.public_url_resolution_failed", {
          claimId: row.claimId,
          receiptError: receiptUrlResult.errorMessage,
          bankStatementError: bankStatementUrlResult.errorMessage,
          supportingError: supportingUrlResult.errorMessage,
        });
      }

      const totalAmountRaw =
        row.detailType === "expense"
          ? toRawAmount(row.expenseTotalAmount)
          : toRawAmount(row.advanceRequestedAmount);
      const totalAmountFormatted =
        row.detailType === "expense"
          ? formatAmountDisplay(row.expenseTotalAmount)
          : formatAmountDisplay(row.advanceRequestedAmount);

      csvLines.push(
        buildCsvRow([
          row.claimId,
          row.status,
          row.submissionType,
          row.detailType,
          row.submittedAt,
          formatDateDisplay(row.submittedAt),
          row.createdAt,
          formatDateDisplay(row.createdAt),
          row.updatedAt,
          formatDateDisplay(row.updatedAt),
          row.hodActionAt,
          formatDateDisplay(row.hodActionAt),
          row.financeActionAt,
          formatDateDisplay(row.financeActionAt),
          row.rejectionReason,
          row.isResubmissionAllowed,
          row.employeeId,
          row.ccEmails,
          row.onBehalfEmail,
          row.onBehalfEmployeeCode,
          row.submittedBy,
          row.onBehalfOfId,
          row.submitterName,
          row.submitterEmail,
          row.beneficiaryName,
          row.beneficiaryEmail,
          row.departmentId,
          row.departmentName,
          row.paymentModeId,
          row.paymentModeName,
          row.assignedL1ApproverId,
          row.assignedL2ApproverId,
          row.l1ApproverName,
          row.l1ApproverEmail,
          row.l2ApproverName,
          row.l2ApproverEmail,
          row.expenseBillNo,
          row.expenseTransactionId,
          row.expenseTransactionDate,
          formatDateDisplay(row.expenseTransactionDate),
          row.expenseCategoryId,
          row.expenseCategoryName,
          row.expenseProductId,
          row.expenseProductName,
          row.expenseLocationId,
          row.expenseLocationName,
          row.detailType === "expense" ? row.expensePurpose : row.advancePurpose,
          toBooleanCsv(row.expenseIsGstApplicable),
          row.expenseGstNumber,
          toRawAmount(row.expenseBasicAmount),
          formatAmountDisplay(row.expenseBasicAmount),
          toRawAmount(row.expenseCgstAmount),
          formatAmountDisplay(row.expenseCgstAmount),
          toRawAmount(row.expenseSgstAmount),
          formatAmountDisplay(row.expenseSgstAmount),
          toRawAmount(row.expenseIgstAmount),
          formatAmountDisplay(row.expenseIgstAmount),
          totalAmountRaw,
          totalAmountFormatted,
          row.expenseCurrencyCode,
          row.expenseVendorName,
          row.expensePeopleInvolved,
          row.expenseRemarks,
          extractFileName(row.expenseReceiptFilePath),
          row.expenseReceiptFilePath,
          receiptUrlResult.data,
          extractFileName(row.expenseBankStatementFilePath),
          row.expenseBankStatementFilePath,
          bankStatementUrlResult.data,
          toRawAmount(row.advanceRequestedAmount),
          formatAmountDisplay(row.advanceRequestedAmount),
          row.advanceBudgetMonth,
          row.advanceBudgetYear,
          row.advanceExpectedUsageDate,
          formatDateDisplay(row.advanceExpectedUsageDate),
          row.advancePurpose,
          row.advanceProductId,
          row.advanceProductName,
          row.advanceLocationId,
          row.advanceLocationName,
          row.advanceRemarks,
          extractFileName(row.advanceSupportingDocumentPath),
          row.advanceSupportingDocumentPath,
          supportingUrlResult.data,
        ]),
      );
    }

    return {
      csvData: `${csvLines.join("\n")}\n`,
      fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
      rowCount: rows.length,
      errorMessage: null,
    };
  }
}
