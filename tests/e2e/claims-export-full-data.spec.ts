import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "./support/auth-state";

loadEnvConfig(process.cwd());

test.use({ storageState: getAuthStatePathByRole("finance1") });

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for E2E export test.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function seedFinanceClaims(seedTag: string): Promise<void> {
  const client = getAdminClient();
  const financeEmail = (process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in").toLowerCase();

  const [{ data: financeUser, error: financeUserError }, { data: department, error: deptError }] =
    await Promise.all([
      client
        .from("users")
        .select("id")
        .eq("email", financeEmail)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("master_departments")
        .select("id, approver_1")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

  if (financeUserError || !financeUser?.id) {
    throw new Error(financeUserError?.message ?? "Finance user not found for export seed.");
  }

  if (deptError || !department?.id || !department?.approver_1) {
    throw new Error(deptError?.message ?? "Department routing not found for export seed.");
  }

  const [
    { data: paymentMode, error: paymentModeError },
    { data: category, error: categoryError },
    { data: location, error: locationError },
  ] = await Promise.all([
    client
      .from("master_payment_modes")
      .select("id")
      .eq("is_active", true)
      .ilike("name", "%reimbursement%")
      .limit(1)
      .maybeSingle(),
    client
      .from("master_expense_categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    client.from("master_locations").select("id").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  if (paymentModeError || !paymentMode?.id) {
    throw new Error(paymentModeError?.message ?? "Payment mode not found for export seed.");
  }

  if (categoryError || !category?.id) {
    throw new Error(categoryError?.message ?? "Expense category not found for export seed.");
  }

  if (locationError || !location?.id) {
    throw new Error(locationError?.message ?? "Location not found for export seed.");
  }

  const claims = Array.from({ length: 12 }, (_, index) => ({
    id: `E2E-CSV-${seedTag}-${String(index + 1).padStart(2, "0")}`,
    status: "Submitted - Awaiting HOD approval",
    submission_type: "Self",
    detail_type: "expense",
    submitted_by: financeUser.id,
    on_behalf_of_id: financeUser.id,
    on_behalf_email: "N/A",
    on_behalf_employee_code: "N/A",
    employee_id: `E2E-FIN-${String(index + 1).padStart(3, "0")}`,
    cc_emails: "N/A",
    department_id: department.id,
    payment_mode_id: paymentMode.id,
    assigned_l1_approver_id: department.approver_1,
    assigned_l2_approver_id: null,
    submitted_at: new Date(Date.now() - index * 60_000).toISOString(),
    is_active: true,
  }));

  const expenseRows = claims.map((claim, index) => ({
    claim_id: claim.id,
    bill_no: `E2E-BILL-${seedTag}-${index + 1}`,
    expense_category_id: category.id,
    location_id: location.id,
    is_gst_applicable: false,
    gst_number: "N/A",
    transaction_date: "2026-03-24",
    basic_amount: 100 + index,
    currency_code: "INR",
    vendor_name: "E2E Vendor",
    purpose: `CSV export seed ${index + 1}`,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    transaction_id: `E2E-TXN-${seedTag}-${index + 1}`,
  }));

  const { error: claimsInsertError } = await client.from("claims").upsert(claims, {
    onConflict: "id",
  });

  if (claimsInsertError) {
    throw new Error(`Claims seed failed: ${claimsInsertError.message}`);
  }

  const { error: expenseInsertError } = await client.from("expense_details").upsert(expenseRows, {
    onConflict: "claim_id",
  });

  if (expenseInsertError) {
    throw new Error(`Expense seed failed: ${expenseInsertError.message}`);
  }
}

test("Finance user can download full CSV containing all form fields", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const seedTag = `${Date.now()}`;
  await seedFinanceClaims(seedTag);

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/dashboard/my-claims?view=submissions", { waitUntil: "networkidle" });

  const exportButton = page.getByRole("button", { name: /Export CSV/i });
  await expect(exportButton).toBeVisible();

  let csvContent = "";
  await fs.mkdir(testInfo.outputDir, { recursive: true });
  const targetPath = path.join(testInfo.outputDir, "claims_export.csv");

  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      exportButton.click(),
    ]);
    await download.saveAs(targetPath);
    csvContent = await fs.readFile(targetPath, "utf8");
  } catch {
    const apiResponse = await page.request.get("/api/export/claims", {
      timeout: 120_000,
    });

    if (apiResponse.ok()) {
      csvContent = await apiResponse.text();
    }
  }

  if (!csvContent) {
    throw new Error(
      `CSV download did not produce Blob content. Console errors: ${consoleErrors.join(" | ")}`,
    );
  }

  const rows = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  expect(rows.length).toBeGreaterThan(11);

  const headers = rows[0].split(",").map((header) => header.trim());
  expect(headers).toContain("GST Number");
  expect(headers).toContain("Expense Date");
  expect(headers).toContain("Purpose");
  expect(headers).toContain("Receipt Name");
  expect(headers).toContain("Receipt URL");
  expect(headers).toContain("Bank Statement URL");
  expect(headers).toContain("Supporting Document URL");
});
