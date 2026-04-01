import { loginFormSchema } from "@/modules/auth/validators/login-schema";

describe("loginFormSchema", () => {
  test("accepts valid payload", () => {
    const parsed = loginFormSchema.safeParse({
      email: "user@nxtwave.co.in",
      password: "password123",
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects invalid email", () => {
    const parsed = loginFormSchema.safeParse({
      email: "invalid-email",
      password: "password123",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.email).toContain("Enter a valid work email");
    }
  });

  test("rejects short password", () => {
    const parsed = loginFormSchema.safeParse({
      email: "user@nxtwave.co.in",
      password: "short",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.password).toContain(
        "Password must be at least 8 characters",
      );
    }
  });

  test("rejects missing fields", () => {
    const parsed = loginFormSchema.safeParse({});

    expect(parsed.success).toBe(false);
  });
});
