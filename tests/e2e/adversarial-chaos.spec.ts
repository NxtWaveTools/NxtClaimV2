import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const defaultPassword = "password123";

type ExpenseRow = {
  claim_id: string;
  bill_no: string;
};

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loginWithEmail(page: Page, email: string): Promise<void> {
  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Auth session missing!/i)).toBeVisible();

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(defaultPassword);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
}

async function setPaymentMode(page: Page, modeName: string): Promise<string> {
  const paymentMode = page.locator("#paymentModeId");

  const modeValue = await paymentMode.evaluate((el, targetName) => {
    const select = el as HTMLSelectElement;
    const option = Array.from(select.options).find((candidate) => candidate.label === targetName);

    return option?.value ?? "";
  }, modeName);

  if (!modeValue) {
    throw new Error(`Payment mode not found: ${modeName}`);
  }

  await paymentMode.evaluate((el, value) => {
    const select = el as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, modeValue);

  return modeValue;
}

async function fillMinimalExpenseClaim(page: Page, billNo: string): Promise<void> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible();

  await setPaymentMode(page, "Reimbursement");

  await page.locator("#employeeId").fill("EMP-CHAOS-1001");
  await page.locator("#billNo").fill(billNo);
  await page.locator("#transactionId").fill(`TXN-${billNo}`);
  await page.locator("#expensePurpose").fill("Adversarial race test");
  await page.locator("#transactionDate").fill("2026-03-17");

  await page.locator("#isGstApplicable").check();
  await page.locator("#gstNumber").fill("GST-CHAOS-123");
  await page.locator("#basicAmount").fill("100");
  await page.locator("#cgstAmount").fill("9");
  await page.locator("#sgstAmount").fill("9");
  await page.locator("#igstAmount").fill("0");

  await expect(page.locator("#totalAmount")).toHaveValue("118.00");
  await page.locator("#receiptFile").setInputFiles(receiptPath);
}

test.describe("Adversarial Chaos Suite", () => {
  test.setTimeout(90000);

  test("The Double-Clicker: 5 rapid submit clicks must not create duplicate claims", async ({
    page,
  }) => {
    await loginWithEmail(page, "user@nxtwave.co.in");

    const billNo = `BILL-CHAOS-${Date.now()}`;
    await fillMinimalExpenseClaim(page, billNo);

    await page.evaluate(() => {
      const submitButton = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;
      if (!submitButton) {
        throw new Error("Submit button not found for chaos test.");
      }

      for (let index = 0; index < 5; index += 1) {
        setTimeout(() => submitButton.click(), index * 20);
      }
    });

    await expect(
      page.getByText(/Claim submitted successfully|already exists|Failed to submit/i),
    ).toBeVisible({
      timeout: 45000,
    });

    const adminClient = createAdminClient();
    if (adminClient) {
      const { data, error } = await adminClient
        .from("expense_details")
        .select("claim_id, bill_no")
        .eq("bill_no", billNo)
        .eq("is_active", true);

      if (error) {
        throw new Error(`Failed to validate duplicate insert behavior: ${error.message}`);
      }

      const rows = (data ?? []) as ExpenseRow[];
      expect(rows.length).toBeLessThanOrEqual(1);
    } else {
      const successToasts = page.getByText(/Claim submitted successfully/i);
      await expect(successToasts).toHaveCount(1);
    }
  });

  test("The URL Hacker: standard employee cannot access finance approvals URL directly", async ({
    page,
  }) => {
    await loginWithEmail(page, "user@nxtwave.co.in");

    const response = await page.goto("/dashboard/finance/approvals", {
      waitUntil: "domcontentloaded",
    });

    const status = response?.status() ?? 0;
    const url = page.url();
    const notFoundVisible = await page
      .getByText(/not found|404|unauthorized|access denied|sign in/i)
      .first()
      .isVisible()
      .catch(() => false);

    const isBlockedByStatus = status === 404 || status === 401 || status === 403;
    const isBlockedByRedirect = !url.includes("/dashboard/finance/approvals");

    expect(isBlockedByStatus || isBlockedByRedirect || notFoundVisible).toBe(true);
  });

  test("The Payload Spoof: request-tampered payment mode must be rejected server-side", async ({
    page,
  }) => {
    await loginWithEmail(page, "user@nxtwave.co.in");

    const billNo = `BILL-SPOOF-${Date.now()}`;
    await fillMinimalExpenseClaim(page, billNo);

    const reimbursementModeId = await setPaymentMode(page, "Reimbursement");
    const corporateCardModeId = await setPaymentMode(page, "Corporate Card");
    await setPaymentMode(page, "Reimbursement");

    let didTamper = false;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (didTamper || request.method() !== "POST") {
        await route.continue();
        return;
      }

      const body = request.postData();
      if (!body || !body.includes(reimbursementModeId)) {
        await route.continue();
        return;
      }

      didTamper = true;
      const tamperedBody = body.replace(reimbursementModeId, corporateCardModeId);

      await route.continue({
        postData: tamperedBody,
      });
    });

    await page.getByRole("button", { name: /submit claim/i }).click();

    await expect(
      page.getByText(/Claim detail type does not match selected payment mode/i),
    ).toBeVisible({
      timeout: 45000,
    });
  });
});
