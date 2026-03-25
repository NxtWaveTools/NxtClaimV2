import path from "node:path";

const defaultEmails = {
  submitter: process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in",
  hod: process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in",
  founder: process.env.E2E_FOUNDER_EMAIL ?? "founder@nxtwave.co.in",
  finance: process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in",
  finance2: process.env.E2E_FINANCE2_EMAIL ?? "finance2@nxtwave.co.in",
} as const;

const statePathByRole = {
  submitter: path.resolve(process.cwd(), ".auth/submitter.json"),
  hod: path.resolve(process.cwd(), ".auth/hod.json"),
  founder: path.resolve(process.cwd(), ".auth/founder.json"),
  finance1: path.resolve(process.cwd(), ".auth/finance1.json"),
  finance2: path.resolve(process.cwd(), ".auth/finance2.json"),
} as const;

export type AuthStateRole = keyof typeof statePathByRole;

const roleByCanonicalEmail = new Map<string, AuthStateRole>([
  [defaultEmails.submitter.toLowerCase(), "submitter"],
  [defaultEmails.hod.toLowerCase(), "hod"],
  [defaultEmails.founder.toLowerCase(), "founder"],
  [defaultEmails.finance.toLowerCase(), "finance1"],
  [defaultEmails.finance2.toLowerCase(), "finance2"],
]);

export function getAuthStatePathByRole(role: AuthStateRole): string {
  return statePathByRole[role];
}

export function getAuthStatePathForEmail(email: string): string | null {
  const role = roleByCanonicalEmail.get(email.trim().toLowerCase());
  return role ? statePathByRole[role] : null;
}

export function registerAuthStateEmail(email: string, role: AuthStateRole): void {
  roleByCanonicalEmail.set(email.trim().toLowerCase(), role);
}

export function getDefaultSeedEmails() {
  return defaultEmails;
}
