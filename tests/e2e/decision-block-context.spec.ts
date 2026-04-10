import { expect, test } from "@playwright/test";
import {
  claimRow,
  getClaimRouting,
  openApprovalsPage,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  resolveUserEmailById,
  submitExpenseClaim,
  waitForClaimRow,
  withActorPage,
} from "./support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `DECISION-BLOCK-${Date.now()}`;

test.describe("Decision Block Form Context", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("Quick View approve button stays in form context and updates row without page reload", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();

    const transactionDate = new Date().toISOString().slice(0, 10);
    const billNo = `DBC-${RUN_TAG}`;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo,
        amount: 332,
        employeeId: `DBC-EMP-${RUN_TAG}`,
        purpose: `Decision block context ${RUN_TAG}`,
        transactionDate,
      });
    });

    const pendingClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo,
    });

    const pendingRouting = await getClaimRouting(pendingClaim.claimId);
    expect(pendingRouting.status).toBe("Submitted - Awaiting HOD approval");

    const l1ApproverEmail = await resolveUserEmailById(pendingRouting.assignedL1ApproverId);

    await withActorPage(browser, l1ApproverEmail, async (page) => {
      await openApprovalsPage(page, pendingClaim.claimId);
      await waitForClaimRow(page, pendingClaim.claimId);

      const row = claimRow(page, pendingClaim.claimId);
      const urlBeforeApprove = page.url();
      const navigationEntriesBefore = await page.evaluate(
        () => performance.getEntriesByType("navigation").length,
      );

      await row
        .getByRole("button", { name: /^View Claim$/i })
        .first()
        .click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15000 });

      const approveButton = dialog.getByRole("button", { name: /^Approve$/i }).first();
      await expect(approveButton).toBeVisible({ timeout: 10000 });

      const isInsideForm = await approveButton.evaluate((element) =>
        Boolean(element.closest("form")),
      );
      expect(isInsideForm).toBe(true);

      await approveButton.click();

      await expect(
        page.getByText(/Claim approved\.|Finance decision approved\./i).first(),
      ).toBeVisible({
        timeout: 30000,
      });
      await expect(dialog).toHaveCount(0);

      expect(page.url()).toBe(urlBeforeApprove);
      const navigationEntriesAfter = await page.evaluate(
        () => performance.getEntriesByType("navigation").length,
      );
      expect(navigationEntriesAfter).toBe(navigationEntriesBefore);

      await expect
        .poll(
          async () => {
            const currentRow = claimRow(page, pendingClaim.claimId);
            return (await currentRow.textContent()) ?? "";
          },
          {
            timeout: 45000,
            message: `waiting for row status update on ${pendingClaim.claimId}`,
          },
        )
        .toMatch(/HOD approved - Awaiting finance approval/i);
    });
  });
});
