import { expect, test } from "@playwright/test";
import {
  claimRow,
  formatInr,
  openApprovalsPage,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  setClaimToFinancePending,
  submitExpenseClaim,
  waitForClaimRow,
  withActorPage,
} from "./support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `MODAL-CACHE-${Date.now()}`;

test.describe("Modal Cache Isolation", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("Quick View modal data is isolated between two claims", async ({ browser }) => {
    const runtime = await resolveRuntimeClaimData();

    const transactionDate = new Date().toISOString().slice(0, 10);
    const firstAmount = 451;
    const secondAmount = 883;

    const firstBillNo = `MCI-A-${RUN_TAG}`;
    const secondBillNo = `MCI-B-${RUN_TAG}`;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: firstBillNo,
        amount: firstAmount,
        employeeId: `MCI-EMP-A-${RUN_TAG}`,
        purpose: `Modal cache isolation A ${RUN_TAG}`,
        transactionDate,
      });

      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: secondBillNo,
        amount: secondAmount,
        employeeId: `MCI-EMP-B-${RUN_TAG}`,
        purpose: `Modal cache isolation B ${RUN_TAG}`,
        transactionDate,
      });
    });

    const firstClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: firstBillNo,
    });

    const secondClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: secondBillNo,
      excludeClaimId: firstClaim.claimId,
    });

    expect(secondClaim.claimId).not.toBe(firstClaim.claimId);

    await setClaimToFinancePending(firstClaim.claimId, runtime.financeApproverId);
    await setClaimToFinancePending(secondClaim.claimId, runtime.financeApproverId);

    await withActorPage(browser, runtime.financeEmail, async (page) => {
      await openApprovalsPage(page);
      await waitForClaimRow(page, firstClaim.claimId);
      await waitForClaimRow(page, secondClaim.claimId);

      const firstRow = claimRow(page, firstClaim.claimId);
      const secondRow = claimRow(page, secondClaim.claimId);

      const firstAmountLabel = formatInr(firstAmount);
      const secondAmountLabel = formatInr(secondAmount);

      await expect(firstRow).toContainText(firstAmountLabel);
      await expect(secondRow).toContainText(secondAmountLabel);

      const dialog = page.getByRole("dialog");

      await firstRow
        .getByRole("button", { name: /^View Claim$/i })
        .first()
        .click();
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(dialog.locator(`#claim-review-title-${firstClaim.claimId}`)).toBeVisible();
      await expect(dialog).toContainText(firstAmountLabel);

      await page
        .getByRole("button", { name: /close review panel/i })
        .first()
        .click();
      await expect(dialog).toHaveCount(0);

      await secondRow
        .getByRole("button", { name: /^View Claim$/i })
        .first()
        .click();
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(dialog.locator(`#claim-review-title-${secondClaim.claimId}`)).toBeVisible();
      await expect(dialog).toContainText(secondAmountLabel);
      await expect(dialog.locator(`#claim-review-title-${firstClaim.claimId}`)).toHaveCount(0);
    });
  });
});
