export const CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS = "Rejected - Resubmission Not Allowed";
export const CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS = "Rejected - Resubmission Allowed";

export const CLAIM_STATUSES = [
  "Submitted",
  "Pending",
  "Approved",
  CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS = "Rejected - Resubmission Not Allowed";
export const DB_REJECTED_RESUBMISSION_ALLOWED_STATUS = "Rejected - Resubmission Allowed";

export const DB_REJECTED_STATUSES = [
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export const DB_CLAIM_STATUSES = [
  "Submitted - Awaiting HOD approval",
  "HOD approved - Awaiting finance approval",
  "Finance Approved - Payment under process",
  "Payment Done - Closed",
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export type DbClaimStatus = (typeof DB_CLAIM_STATUSES)[number];

export function mapDbClaimStatusToCanonical(status: DbClaimStatus): ClaimStatus {
  switch (status) {
    case "Submitted - Awaiting HOD approval":
      return "Submitted";
    case "HOD approved - Awaiting finance approval":
      return "Pending";
    case "Finance Approved - Payment under process":
    case "Payment Done - Closed":
      return "Approved";
    case DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS:
      return CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS;
    case DB_REJECTED_RESUBMISSION_ALLOWED_STATUS:
      return CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS;
    default:
      return "Pending";
  }
}

export function mapCanonicalStatusToDbStatuses(status: ClaimStatus): DbClaimStatus[] {
  switch (status) {
    case "Submitted":
      return ["Submitted - Awaiting HOD approval"];
    case "Pending":
      return ["HOD approved - Awaiting finance approval"];
    case "Approved":
      return ["Finance Approved - Payment under process", "Payment Done - Closed"];
    case CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS:
      return [DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS];
    case CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS:
      return [DB_REJECTED_RESUBMISSION_ALLOWED_STATUS];
    default:
      return [];
  }
}
