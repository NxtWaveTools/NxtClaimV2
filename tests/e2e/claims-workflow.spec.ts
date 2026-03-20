import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const STARTING_USER_EMAIL = "user@nxtwave.co.in";
const STARTING_HOD_EMAIL = "hod@nxtwave.co.in";
const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const RUN_TAG = process.env.E2E_RUN_TAG ?? `WF-${Date.now()}`;

type KnownRole = "submitter" | "hod" | "founder" | "finance1" | "finance2";

type UserRecord = {
  id: string;
  email: string;
  full_name: string | null;
};

type DepartmentRecord = {
  id: string;
  name: string;
  approver_1: string;
  approver_2: string;
};

type FinanceApproverRecord = {
  id: string;
  user_id: string;
  is_primary: boolean;
  created_at: string;
};

type RuntimeActors = {
  submitter: UserRecord;
  hod: UserRecord;
  founder: UserRecord;
  finance1: UserRecord;
  finance2: UserRecord;
  submitterDepartment: DepartmentRecord;
  hodDepartment: DepartmentRecord;
  expenseCategoryName: string;
  founderDepartment: DepartmentRecord | null;
  crossDepartmentCandidate: {
    department: DepartmentRecord;
    approverRole: KnownRole;
  } | null;
};

type ActorSession = {
  role: KnownRole;
  user: UserRecord;
  context: BrowserContext;
  page: Page;
};

type SubmittedClaim = {
  claimId: string;
  marker: string;
};

type ClaimRouting = {
  departmentId: string;
  status: string;
  assignedL1ApproverId: string;
  assignedL2ApproverId: string | null;
};

const actorSessions = new Map<KnownRole, ActorSession>();
let runtimeActors: RuntimeActors;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Playwright workflow tests.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getUsersByEmails(emails: string[]): Promise<Map<string, UserRecord>> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("users")
    .select("id, email, full_name")
    .in("email", emails)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  const users = (data ?? []) as UserRecord[];
  return new Map(users.map((row) => [row.email.toLowerCase(), row]));
}

async function resolveSubmitterDepartment(submitter: UserRecord): Promise<DepartmentRecord> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  const departments = (data ?? []) as DepartmentRecord[];
  if (departments.length === 0) {
    throw new Error("No active departments found.");
  }

  const latestClaimDepartmentResult = await client
    .from("claims")
    .select("department_id")
    .eq("submitted_by", submitter.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestClaimDepartmentResult.error) {
    throw new Error(
      `Failed to infer submitter department from existing claims: ${latestClaimDepartmentResult.error.message}`,
    );
  }

  const latestDepartmentId = latestClaimDepartmentResult.data?.department_id as string | undefined;
  if (latestDepartmentId) {
    const byLatestClaim = departments.find((department) => department.id === latestDepartmentId);
    if (byLatestClaim) {
      return byLatestClaim;
    }
  }

  const nonSelfHodDepartment = departments.find(
    (department) => department.approver_1 !== submitter.id,
  );
  return nonSelfHodDepartment ?? departments[0];
}

function resolveRoleByUserId(userId: string): KnownRole | null {
  if (userId === runtimeActors.submitter.id) {
    return "submitter";
  }
  if (userId === runtimeActors.hod.id) {
    return "hod";
  }
  if (userId === runtimeActors.founder.id) {
    return "founder";
  }
  if (userId === runtimeActors.finance1.id) {
    return "finance1";
  }
  if (userId === runtimeActors.finance2.id) {
    return "finance2";
  }
  return null;
}

async function resolveRuntimeActors(): Promise<RuntimeActors> {
  const startingUsers = await getUsersByEmails([STARTING_USER_EMAIL, STARTING_HOD_EMAIL]);
  const submitter = startingUsers.get(STARTING_USER_EMAIL);
  const knownHod = startingUsers.get(STARTING_HOD_EMAIL);

  if (!submitter) {
    throw new Error(`Starting submitter account ${STARTING_USER_EMAIL} was not found.`);
  }

  const submitterDepartment = await resolveSubmitterDepartment(submitter);
  const lookupUserIds = new Set<string>([
    submitterDepartment.approver_1,
    submitterDepartment.approver_2,
  ]);

  const client = getAdminSupabaseClient();
  const financeResult = await client
    .from("master_finance_approvers")
    .select("id, user_id, is_primary, created_at")
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(2);

  if (financeResult.error) {
    throw new Error(`Failed to load finance approvers: ${financeResult.error.message}`);
  }

  const financeApprovers = (financeResult.data ?? []) as FinanceApproverRecord[];
  if (financeApprovers.length < 2) {
    throw new Error("At least two active finance approvers are required for workflow tests.");
  }

  for (const approver of financeApprovers) {
    lookupUserIds.add(approver.user_id);
  }

  if (knownHod?.id) {
    lookupUserIds.add(knownHod.id);
  }

  const departmentsResult = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true)
    .eq("approver_1", knownHod?.id ?? submitterDepartment.approver_1)
    .limit(1)
    .maybeSingle();

  if (departmentsResult.error) {
    throw new Error(`Failed to resolve HOD department: ${departmentsResult.error.message}`);
  }

  const fallbackHodId = knownHod?.id ?? submitterDepartment.approver_1;
  const hodDepartment = (departmentsResult.data as DepartmentRecord | null) ?? {
    ...submitterDepartment,
    approver_1: fallbackHodId,
  };

  lookupUserIds.add(hodDepartment.approver_1);
  lookupUserIds.add(hodDepartment.approver_2);

  const usersByIdResult = await client
    .from("users")
    .select("id, email, full_name")
    .in("id", [...lookupUserIds])
    .eq("is_active", true);

  if (usersByIdResult.error) {
    throw new Error(`Failed to resolve role users: ${usersByIdResult.error.message}`);
  }

  const usersById = new Map(
    ((usersByIdResult.data ?? []) as UserRecord[]).map((row) => [row.id, row]),
  );

  const submitterHod = usersById.get(submitterDepartment.approver_1);
  const hodFounder = usersById.get(hodDepartment.approver_2);

  if (!submitterHod || !hodFounder) {
    throw new Error("Unable to resolve HOD/Founder users as active accounts.");
  }

  const finance1 = usersById.get(financeApprovers[0].user_id);
  const finance2 = usersById.get(financeApprovers[1].user_id);

  if (!finance1 || !finance2) {
    throw new Error("Unable to resolve finance approver users.");
  }

  const categoryResult = await client
    .from("master_expense_categories")
    .select("name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (categoryResult.error || !categoryResult.data?.name) {
    throw new Error(
      `Failed to resolve active expense category: ${categoryResult.error?.message ?? "not found"}`,
    );
  }

  const activeDepartmentsResult = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true);

  if (activeDepartmentsResult.error) {
    throw new Error(
      `Failed to resolve active departments for edge workflows: ${activeDepartmentsResult.error.message}`,
    );
  }

  const activeDepartments = (activeDepartmentsResult.data ?? []) as DepartmentRecord[];
  const founderDepartment =
    activeDepartments.find((department) => department.approver_2 === hodFounder.id) ?? null;

  const knownApproverIds = new Set([submitterHod.id, hodFounder.id, finance1.id, finance2.id]);
  const crossCandidate =
    activeDepartments
      .filter((department) => department.id !== submitterDepartment.id)
      .filter((department) => department.approver_1 !== submitterDepartment.approver_1)
      .find((department) => knownApproverIds.has(department.approver_1)) ?? null;

  const crossDepartmentCandidate =
    crossCandidate === null
      ? null
      : {
          department: crossCandidate,
          approverRole: (resolveRoleByUserIdFromKnownUsers(
            crossCandidate.approver_1,
            submitterHod,
            hodFounder,
            finance1,
            finance2,
          ) ?? "hod") as KnownRole,
        };

  return {
    submitter,
    hod: submitterHod,
    founder: hodFounder,
    finance1,
    finance2,
    submitterDepartment,
    hodDepartment,
    expenseCategoryName: categoryResult.data.name as string,
    founderDepartment,
    crossDepartmentCandidate,
  };
}

function resolveRoleByUserIdFromKnownUsers(
  userId: string,
  hod: UserRecord,
  founder: UserRecord,
  finance1: UserRecord,
  finance2: UserRecord,
): KnownRole | null {
  if (userId === hod.id) {
    return "hod";
  }
  if (userId === founder.id) {
    return "founder";
  }
  if (userId === finance1.id) {
    return "finance1";
  }
  if (userId === finance2.id) {
    return "finance2";
  }
  return null;
}

async function loginToContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });

  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in with email/i }).click();

  await page.waitForURL("**/dashboard", { timeout: 60000 });
  await Promise.race([
    page.getByRole("heading", { name: /dashboard/i }).waitFor({ state: "visible", timeout: 15000 }),
    page
      .getByRole("heading", { name: /wallet summary/i })
      .waitFor({ state: "visible", timeout: 15000 }),
    page.getByRole("link", { name: /my claims/i }).waitFor({ state: "visible", timeout: 15000 }),
  ]);

  return page;
}

async function setupActorSessions(browser: Browser, actors: RuntimeActors): Promise<void> {
  const roleToUser: Record<KnownRole, UserRecord> = {
    submitter: actors.submitter,
    hod: actors.hod,
    founder: actors.founder,
    finance1: actors.finance1,
    finance2: actors.finance2,
  };

  for (const role of Object.keys(roleToUser) as KnownRole[]) {
    const context = await browser.newContext();
    const page = await loginToContext(context, roleToUser[role].email, DEFAULT_PASSWORD);
    actorSessions.set(role, {
      role,
      user: roleToUser[role],
      context,
      page,
    });
    await page.waitForTimeout(1500);
  }
}

async function forceSupabaseSchemaRefresh(): Promise<void> {
  const supabase = getAdminSupabaseClient();

  try {
    await supabase.rpc("reload_schema_cache");
  } catch {
    await supabase.from("_reload").select("*");
  }

  try {
    await supabase.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
  } catch {
    // Best effort cache refresh for environments without this helper RPC.
  }
}

function getActorPage(role: KnownRole): Page {
  const session = actorSessions.get(role);
  if (!session) {
    throw new Error(`No actor session for role ${role}`);
  }

  return session.page;
}

function getActorByRole(role: KnownRole): UserRecord {
  const session = actorSessions.get(role);
  if (!session) {
    throw new Error(`No actor session for role ${role}`);
  }

  return session.user;
}

async function closeActorSessions(): Promise<void> {
  for (const session of actorSessions.values()) {
    try {
      await session.context.close();
    } catch {
      // Ignore teardown issues when a context is already disposed.
    }
  }
  actorSessions.clear();
}

async function selectDropdownOption(page: Page, label: string, value: string): Promise<void> {
  const combobox = page.getByRole("combobox", { name: new RegExp(label, "i") });
  await combobox.click();

  const optionByRole = page.getByRole("option", { name: new RegExp(`^${value}$`, "i") }).first();
  const optionCount = await optionByRole.count();

  if (optionCount > 0) {
    await optionByRole.click({ force: true }).catch(() => null);
  }

  await combobox.selectOption({ label: value });
}

async function openNewClaimForm(page: Page): Promise<void> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /new claim/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({ timeout: 15000 });
}

async function resolveClaimIdByBillNo(submitterId: string, billNo: string): Promise<string> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("id, expense_details!inner(bill_no)")
    .eq("submitted_by", submitterId)
    .eq("expense_details.bill_no", billNo)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve claim id for bill no ${billNo}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`No claim found for submitter ${submitterId} and bill no ${billNo}.`);
  }

  return data.id as string;
}

async function resolveClaimIdByAdvancePurpose(
  submitterId: string,
  purpose: string,
): Promise<string> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("id, advance_details!inner(purpose)")
    .eq("submitted_by", submitterId)
    .eq("advance_details.purpose", purpose)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve claim id for advance purpose ${purpose}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`No claim found for submitter ${submitterId} and advance purpose ${purpose}.`);
  }

  return data.id as string;
}

function newMarker(prefix: string): string {
  return `${prefix}-${RUN_TAG}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function submitReimbursementClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
    onBehalfOfEmail?: string;
    onBehalfOfEmployeeCode?: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = `${input.actorRole.toUpperCase()}-${marker}`;
  const billNo = `BILL-${marker}`;
  const transactionId = `TXN-${marker}`;

  if (input.onBehalfOfEmail && input.onBehalfOfEmployeeCode) {
    await selectDropdownOption(page, "Submission Type", "On Behalf");
    await page.locator("#onBehalfEmail").fill(input.onBehalfOfEmail);
    await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfOfEmployeeCode);
  }

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Reimbursement");
  await selectDropdownOption(page, "Expense Category", runtimeActors.expenseCategoryName);

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#billNo").fill(billNo);
  await page.locator("#transactionId").fill(transactionId);
  await page.locator("#expensePurpose").fill(`${input.workflowLabel} ${marker}`);
  await page.locator("#transactionDate").fill("2026-03-18");
  await page.locator("#basicAmount").fill(String(input.amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page.getByText(/claim submitted successfully/i)).toBeVisible({ timeout: 30000 });

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByBillNo(actor.id, billNo);

  return { claimId, marker };
}

async function submitPettyCashRequestClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = `${input.actorRole.toUpperCase()}-${marker}`;
  const budgetMonth = "3";
  const budgetYear = "2026";
  const purpose = `${input.workflowLabel} ${marker}`;

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Petty Cash Request");

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#requestedAmount").fill(String(input.amount));
  await page.locator("#expectedUsageDate").fill("2026-03-24");
  await page.locator("#budgetMonth").selectOption(budgetMonth);
  await page.locator("#budgetYear").selectOption(budgetYear);
  await page.locator("#purpose").fill(purpose);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page.getByText(/claim submitted successfully/i)).toBeVisible({ timeout: 30000 });

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByAdvancePurpose(actor.id, purpose);

  return { claimId, marker };
}

async function submitPettyCashExpenseClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = `${input.actorRole.toUpperCase()}-${marker}`;
  const billNo = `BILL-${marker}`;
  const transactionId = `TXN-${marker}`;

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Petty Cash");
  await selectDropdownOption(page, "Expense Category", runtimeActors.expenseCategoryName);

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#billNo").fill(billNo);
  await page.locator("#transactionId").fill(transactionId);
  await page.locator("#expensePurpose").fill(`${input.workflowLabel} ${marker}`);
  await page.locator("#transactionDate").fill("2026-03-18");
  await page.locator("#basicAmount").fill(String(input.amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page.getByText(/claim submitted successfully/i)).toBeVisible({ timeout: 30000 });

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByBillNo(actor.id, billNo);

  return { claimId, marker };
}

async function openApprovalsHistory(page: Page): Promise<void> {
  await page.goto("/dashboard/my-claims?view=approvals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible({
    timeout: 20000,
  });
}

async function openMyClaims(page: Page): Promise<void> {
  await page.goto("/dashboard/my-claims", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /my claims/i })).toBeVisible({ timeout: 20000 });
}

function claimRow(page: Page, claimId: string): Locator {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
}

async function clickApproveButton(row: Locator): Promise<void> {
  const approveButton = row.getByRole("button", { name: /^(approve|ok)$/i }).first();
  await approveButton.click();
}

async function approveAtCurrentScope(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await clickApproveButton(row);
  await expect(page.getByText(/approved\./i)).toBeVisible({ timeout: 30000 });
}

async function rejectAtCurrentScope(page: Page, claimId: string, reason: string): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await row
    .getByRole("button", { name: /^reject$/i })
    .first()
    .click();

  const reasonBox = row.locator("textarea[name='rejectionReason']").first();
  await expect(reasonBox).toBeVisible({ timeout: 10000 });
  await reasonBox.fill(reason);

  await row
    .getByRole("button", { name: /^reject$/i })
    .last()
    .click();
  await expect(page.getByText(/rejected\./i)).toBeVisible({ timeout: 30000 });
}

async function markPaidAtFinance(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await row
    .getByRole("button", { name: /^paid$|mark as paid/i })
    .first()
    .click();
  await expect(page.getByText(/marked as paid\./i)).toBeVisible({ timeout: 30000 });
}

async function expectClaimVisibleInApprovals(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function expectClaimVisibleInMyClaims(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openMyClaims(page);
  const row = claimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function expectClaimStatusInMyClaims(
  page: Page,
  claimId: string,
  statusText: string,
): Promise<void> {
  await openMyClaims(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText(new RegExp(statusText, "i"));
}

async function expectClaimStatusInApprovals(
  page: Page,
  claimId: string,
  statusText: string,
): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText(new RegExp(statusText, "i"));
}

async function assertClaimStatusInDb(claimId: string, expectedStatus: string): Promise<void> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("status")
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to assert status for claim ${claimId}: ${error.message}`);
  }

  expect(data?.status).toBe(expectedStatus);
}

async function getClaimRouting(claimId: string): Promise<ClaimRouting> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("department_id, status, assigned_l1_approver_id, assigned_l2_approver_id")
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read routing for claim ${claimId}: ${error.message}`);
  }

  if (!data?.assigned_l1_approver_id || !data?.department_id || !data?.status) {
    throw new Error(`Routing record missing required fields for claim ${claimId}.`);
  }

  return {
    departmentId: data.department_id as string,
    status: data.status as string,
    assignedL1ApproverId: data.assigned_l1_approver_id as string,
    assignedL2ApproverId: (data.assigned_l2_approver_id as string | null) ?? null,
  };
}

async function assertClaimRouting(claimId: string, expectedL1ApproverId: string): Promise<void> {
  const routing = await getClaimRouting(claimId);
  expect(routing.assignedL1ApproverId).toBe(expectedL1ApproverId);
}

async function getWalletPettyCashBalance(userId: string): Promise<number> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("wallets")
    .select("petty_cash_balance")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Strict wallets table query failed for user ${userId}: ${error.message}`);
  }

  const raw = data?.petty_cash_balance as number | string | null | undefined;
  if (raw === undefined || raw === null) {
    throw new Error(`No petty_cash_balance row found in wallets for user ${userId}.`);
  }

  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new Error(`petty_cash_balance is non-numeric for user ${userId}: ${String(raw)}`);
  }

  return numeric;
}

function assertWalletDelta(before: number, after: number, expectedDelta: number): void {
  expect(after - before).toBeCloseTo(expectedDelta, 2);
}

test.describe("Claims Workflow Multi-Role E2E", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(480000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240000);
    await forceSupabaseSchemaRefresh();
    runtimeActors = await resolveRuntimeActors();
    await setupActorSessions(browser, runtimeActors);
  });

  test.afterAll(async () => {
    await closeActorSessions();
  });

  test("Flow 1: standard happy path closes claim and keeps global history visibility", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 301.25,
      workflowLabel: "FLOW1-HAPPY",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
  });

  test("Flow 2: L1 rejection remains private from finance users", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 217.4,
      workflowLabel: "FLOW2-HOD-REJECT",
    });

    await rejectAtCurrentScope(hodPage, submitted.claimId, "L1 rejection privacy validation.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(submitterPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);

    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, false);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, false);

    await expectClaimVisibleInMyClaims(finance1Page, submitted.claimId, false);
    await expectClaimVisibleInMyClaims(finance2Page, submitted.claimId, false);
  });

  test("Flow 3: HOD self-submission escalates to founder and finance rejection remains globally visible", async () => {
    const hodPage = getActorPage("hod");
    const founderPage = getActorPage("founder");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(hodPage, {
      actorRole: "hod",
      departmentName: runtimeActors.hodDepartment.name,
      amount: 412.6,
      workflowLabel: "FLOW3-HOD-ESCALATION",
    });

    await assertClaimRouting(submitted.claimId, runtimeActors.founder.id);

    await approveAtCurrentScope(founderPage, submitted.claimId);
    await rejectAtCurrentScope(
      finance1Page,
      submitted.claimId,
      "L2 rejection global visibility validation.",
    );

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(hodPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(hodPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(founderPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
  });

  test("Flow 4: petty cash advance approval increases wallet by exactly 40000", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const amount = 40000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashRequestClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW4-PC-ADVANCE",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, amount);
  });

  test("Flow 5: petty cash expense rejected at L1 keeps wallet unchanged", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const amount = 30000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW5-PC-EXPENSE-HOD-REJECT",
    });

    await rejectAtCurrentScope(hodPage, submitted.claimId, "L1 rejected petty cash expense.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, 0);
  });

  test("Flow 6: petty cash expense rejected at finance keeps wallet unchanged and remains visible to finance2 history", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");
    const amount = 15000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW6-PC-EXPENSE-FIN-REJECT",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await rejectAtCurrentScope(finance1Page, submitted.claimId, "L2 rejected petty cash expense.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, 0);

    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
    await expectClaimStatusInApprovals(finance2Page, submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(submitterPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);
    await expectClaimStatusInApprovals(hodPage, submitted.claimId, "Rejected");
  });

  test("Flow 7: fully approved petty cash expense decreases wallet by exactly 10000", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const amount = 10000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW7-PC-EXPENSE-FULL-APPROVAL",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, -amount);
  });

  test("Edge Workflow A (AI-generated): cross-department routing locks to target L1 approver and isolates original HOD", async () => {
    test.skip(
      runtimeActors.crossDepartmentCandidate === null,
      "No cross-department candidate found with a known approver actor.",
    );

    const submitterPage = getActorPage("submitter");
    const originalHodPage = getActorPage("hod");
    const candidate = runtimeActors.crossDepartmentCandidate!;
    const targetApproverPage = getActorPage(candidate.approverRole);

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: candidate.department.name,
      amount: 219.45,
      workflowLabel: "EDGE-A-CROSS-DEPT",
    });

    const routing = await getClaimRouting(submitted.claimId);
    expect(routing.departmentId).toBe(candidate.department.id);
    expect(routing.assignedL1ApproverId).toBe(candidate.department.approver_1);

    await expectClaimVisibleInApprovals(originalHodPage, submitted.claimId, false);
    await expectClaimVisibleInApprovals(targetApproverPage, submitted.claimId, true);

    await rejectAtCurrentScope(
      targetApproverPage,
      submitted.claimId,
      "Cross-department edge-case rejection.",
    );
    await assertClaimStatusInDb(submitted.claimId, "Rejected");
  });

  test("Edge Workflow B (AI-generated): founder self-submission routing and rejection boundaries across founder/finance actors", async () => {
    test.skip(runtimeActors.founderDepartment === null, "No founder-associated department found.");

    const founderPage = getActorPage("founder");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(founderPage, {
      actorRole: "founder",
      departmentName: runtimeActors.founderDepartment!.name,
      amount: 277.11,
      workflowLabel: "EDGE-B-FOUNDER-SELF",
    });

    const routing = await getClaimRouting(submitted.claimId);
    const l1Role = resolveRoleByUserId(routing.assignedL1ApproverId);

    expect(routing.assignedL1ApproverId).toBeTruthy();
    await expectClaimVisibleInMyClaims(founderPage, submitted.claimId, true);

    if (l1Role === "founder") {
      await rejectAtCurrentScope(
        founderPage,
        submitted.claimId,
        "Founder self-routed rejection boundary.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, false);
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, false);
      return;
    }

    if (l1Role === "hod") {
      await approveAtCurrentScope(hodPage, submitted.claimId);
      await rejectAtCurrentScope(
        finance1Page,
        submitted.claimId,
        "Founder self-submission finance rejection boundary.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
      return;
    }

    if (l1Role === "finance1") {
      await rejectAtCurrentScope(
        finance1Page,
        submitted.claimId,
        "Founder routed directly to finance1.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
      return;
    }

    if (l1Role === "finance2") {
      await rejectAtCurrentScope(
        finance2Page,
        submitted.claimId,
        "Founder routed directly to finance2.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
      return;
    }

    throw new Error(
      `Founder self-submission assigned to unsupported L1 approver ${routing.assignedL1ApproverId}; add actor coverage for this user in E2E setup.`,
    );
  });
});
