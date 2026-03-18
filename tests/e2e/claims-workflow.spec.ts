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
  reimbursementPaymentModeId: string;
  expenseCategoryName: string;
};

type ActorSession = {
  role: KnownRole;
  user: UserRecord;
  context: BrowserContext;
  page: Page;
};

type SubmittedClaim = {
  claimId: string;
  billNo: string;
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

  const reimbursementModeResult = await client
    .from("master_payment_modes")
    .select("id, name")
    .eq("is_active", true)
    .ilike("name", "Reimbursement")
    .limit(1)
    .maybeSingle();

  if (reimbursementModeResult.error || !reimbursementModeResult.data?.id) {
    throw new Error(
      `Failed to resolve reimbursement payment mode: ${reimbursementModeResult.error?.message ?? "not found"}`,
    );
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

  return {
    submitter,
    hod: submitterHod,
    founder: hodFounder,
    finance1,
    finance2,
    submitterDepartment,
    hodDepartment,
    reimbursementPaymentModeId: reimbursementModeResult.data.id as string,
    expenseCategoryName: categoryResult.data.name as string,
  };
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

  await page.waitForURL("**/dashboard", { timeout: 45000 });
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15000 });
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
  }
}

function getActorPage(role: KnownRole): Page {
  const session = actorSessions.get(role);
  if (!session) {
    throw new Error(`No actor session for role ${role}`);
  }

  return session.page;
}

async function closeActorSessions(): Promise<void> {
  for (const session of actorSessions.values()) {
    try {
      await session.context.close();
    } catch {
      // Ignore teardown issues if a context is already disposed.
    }
  }
  actorSessions.clear();
}

function toCurrencyNumber(value: string): number {
  const normalized = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function submitExpenseClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
    onBehalfOfEmail?: string;
    onBehalfOfEmployeeCode?: string;
    employeeCodePrefix?: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const suffix = `${RUN_TAG}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const employeeCode = `${input.employeeCodePrefix ?? input.actorRole.toUpperCase()}-${suffix}`;
  const billNo = `BILL-${suffix}`;
  const transactionId = `TXN-${suffix}`;

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
  await page.locator("#expensePurpose").fill(`${input.workflowLabel} ${suffix}`);
  await page.locator("#transactionDate").fill("2026-03-18");
  await page.locator("#basicAmount").fill(String(input.amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page.getByText(/claim submitted successfully/i)).toBeVisible({ timeout: 30000 });

  const actor = actorSessions.get(input.actorRole);
  if (!actor) {
    throw new Error(`Cannot resolve actor for ${input.actorRole}`);
  }

  const claimId = await resolveClaimIdByBillNo(actor.user.id, billNo);
  return { claimId, billNo };
}

async function openApprovalsHistory(page: Page): Promise<void> {
  await page.goto("/dashboard/my-claims?view=approvals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible();
}

function claimRow(page: Page, claimId: string): Locator {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
}

async function approveAtCurrentScope(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await row
    .getByRole("button", { name: /^approve$/i })
    .first()
    .click();
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
  await expect(page.getByText(/claim rejected\./i)).toBeVisible({ timeout: 30000 });
}

async function markPaidAtFinance(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await row
    .getByRole("button", { name: /^paid$|mark as paid/i })
    .first()
    .click();
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

async function assertClaimRouting(claimId: string, expectedL1ApproverId: string): Promise<void> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("assigned_l1_approver_id")
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read routing for claim ${claimId}: ${error.message}`);
  }

  expect(data?.assigned_l1_approver_id).toBe(expectedL1ApproverId);
}

async function getFounderReimbursementTotal(founderUserId: string): Promise<number> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("expense_details(total_amount)")
    .eq("on_behalf_of_id", founderUserId)
    .eq("is_active", true)
    .eq("payment_mode_id", runtimeActors.reimbursementPaymentModeId)
    .eq("status", "Payment Done - Closed");

  if (error) {
    throw new Error(`Failed to query founder reimbursement totals: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    expense_details: { total_amount: number | string | null } | null;
  }>;
  return rows.reduce((sum, row) => {
    const raw = row.expense_details?.total_amount;
    const value = typeof raw === "number" ? raw : Number(raw ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

async function getFounderAmountReceivedCardValue(founderPage: Page): Promise<number> {
  await founderPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(founderPage.getByRole("heading", { name: /wallet summary/i })).toBeVisible({
    timeout: 15000,
  });
  const amountText = await founderPage
    .locator("article", { hasText: "Amount Received" })
    .locator("p")
    .nth(1)
    .innerText();
  return toCurrencyNumber(amountText);
}

test.describe("Claims Workflow Multi-Role E2E", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(480000);

  test.beforeAll(async ({ browser }) => {
    runtimeActors = await resolveRuntimeActors();
    await setupActorSessions(browser, runtimeActors);
  });

  test.afterAll(async () => {
    await closeActorSessions();
  });

  test("Workflow 1: happy path reaches Payment Done - Closed", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const financePage = getActorPage("finance1");

    const submitted = await submitExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 301.25,
      workflowLabel: "WF1-HAPPY",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(financePage, submitted.claimId);
    await markPaidAtFinance(financePage, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");
  });

  test("Workflow 2: HOD rejection stays private from finance queues", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 217.4,
      workflowLabel: "WF2-HOD-REJECT",
    });

    await rejectAtCurrentScope(
      hodPage,
      submitted.claimId,
      "Rejected in workflow 2 for privacy validation.",
    );

    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, false);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, false);
    await assertClaimStatusInDb(submitted.claimId, "Rejected");
  });

  test("Workflow 3: finance rejected claim is visible in global finance queue", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 412.6,
      workflowLabel: "WF3-FINANCE-GLOBAL",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await rejectAtCurrentScope(
      finance1Page,
      submitted.claimId,
      "Rejected by finance 1 for global queue visibility test.",
    );

    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
    await assertClaimStatusInDb(submitted.claimId, "Rejected");
  });

  test("Workflow 4: HOD self-submission escalates to founder then closes", async () => {
    const hodPage = getActorPage("hod");
    const founderPage = getActorPage("founder");
    const financePage = getActorPage("finance1");

    const submitted = await submitExpenseClaim(hodPage, {
      actorRole: "hod",
      departmentName: runtimeActors.hodDepartment.name,
      amount: 189.9,
      workflowLabel: "WF4-HOD-ESCALATION",
      employeeCodePrefix: "HOD",
    });

    await assertClaimRouting(submitted.claimId, runtimeActors.founder.id);
    await approveAtCurrentScope(founderPage, submitted.claimId);
    await approveAtCurrentScope(financePage, submitted.claimId);
    await markPaidAtFinance(financePage, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");
  });

  test("Workflow 5: On Behalf founder reimbursement updates wallet math", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const financePage = getActorPage("finance1");
    const founderPage = getActorPage("founder");
    const amount = 523.35;

    const founderDbBefore = await getFounderReimbursementTotal(runtimeActors.founder.id);
    const founderAmountReceivedBefore = await getFounderAmountReceivedCardValue(founderPage);

    const submitted = await submitExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "WF5-ON-BEHALF-FOUNDER",
      onBehalfOfEmail: runtimeActors.founder.email,
      onBehalfOfEmployeeCode: `OB-${RUN_TAG}`,
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(financePage, submitted.claimId);
    await markPaidAtFinance(financePage, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    const founderDbAfter = await getFounderReimbursementTotal(runtimeActors.founder.id);
    expect(founderDbAfter - founderDbBefore).toBeCloseTo(amount, 2);

    const founderAmountReceivedAfter = await getFounderAmountReceivedCardValue(founderPage);
    expect(founderAmountReceivedAfter - founderAmountReceivedBefore).toBeCloseTo(amount, 2);
  });
});
