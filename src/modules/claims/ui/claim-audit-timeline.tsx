import type { ClaimAuditLogRecord } from "@/core/domain/claims/contracts";

type ClaimAuditTimelineProps = {
  logs: ClaimAuditLogRecord[];
  title?: string;
  emptyLabel?: string;
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function describeAction(actionType: ClaimAuditLogRecord["actionType"]): string {
  if (actionType === "SUBMITTED") {
    return "Claim submitted";
  }

  if (actionType === "L1_APPROVED") {
    return "Approved at L1";
  }

  if (actionType === "L1_REJECTED") {
    return "Rejected at L1";
  }

  if (actionType === "L2_APPROVED") {
    return "Approved by Finance";
  }

  return "Rejected by Finance";
}

function buildActorLabel(log: ClaimAuditLogRecord): string {
  if (log.actorName && log.actorEmail) {
    return `${log.actorName} (${log.actorEmail})`;
  }

  return log.actorName ?? log.actorEmail ?? "Unknown actor";
}

function buildAssigneeLabel(log: ClaimAuditLogRecord): string | null {
  if (!log.assignedToId) {
    return null;
  }

  if (log.assignedToName && log.assignedToEmail) {
    return `${log.assignedToName} (${log.assignedToEmail})`;
  }

  return log.assignedToName ?? log.assignedToEmail ?? "Next assignee";
}

export function ClaimAuditTimeline({
  logs,
  title = "Audit History",
  emptyLabel = "No audit entries are available for this claim.",
}: ClaimAuditTimelineProps) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-700 dark:text-slate-300">
        {title}
      </h3>

      {logs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4 dark:border-slate-700">
          {logs.map((log) => {
            const assigneeLabel = buildAssigneeLabel(log);

            return (
              <li key={log.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                  {formatDateTime(log.createdAt)}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {describeAction(log.actionType)}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  By {buildActorLabel(log)}
                </p>
                {assigneeLabel ? (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                    Assigned to {assigneeLabel}
                  </p>
                ) : null}
                {log.remarks ? (
                  <p className="mt-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    Remarks: {log.remarks}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
