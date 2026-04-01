import {
  ALLOWED_AUTH_DOMAINS,
  getEmailDomain,
  isAllowedEmailDomain,
} from "@/core/config/allowed-domains";

describe("allowed domains", () => {
  test("extracts normalized domain from email", () => {
    expect(getEmailDomain("  USER@NXTWAVE.CO.IN  ")).toBe("nxtwave.co.in");
  });

  test("returns empty domain for malformed email", () => {
    expect(getEmailDomain("missing-at-symbol")).toBe("");
  });

  test("returns true for allowlisted domains", () => {
    for (const domain of ALLOWED_AUTH_DOMAINS) {
      expect(isAllowedEmailDomain(`user@${domain}`)).toBe(true);
    }
  });

  test("returns false for blocked domains", () => {
    expect(isAllowedEmailDomain("user@example.com")).toBe(false);
  });
});
