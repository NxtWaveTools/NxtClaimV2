/** @jest-environment node */

const mockEnforceDomainOnCurrentSession = jest.fn();
const mockRepositoryConstructor = jest.fn();

jest.mock("@/core/domain/auth/auth.service", () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    enforceDomainOnCurrentSession: (...args: unknown[]) =>
      mockEnforceDomainOnCurrentSession(...args),
  })),
}));

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => {
    mockRepositoryConstructor();
    return {};
  }),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

import { ROUTES } from "@/core/config/route-registry";
import { resolveRootRoute } from "@/modules/auth/server/resolve-root-route";

describe("resolveRootRoute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns login route when session is invalid", async () => {
    mockEnforceDomainOnCurrentSession.mockResolvedValueOnce({
      valid: false,
      hasUser: false,
      errorCode: "AUTH_FAILED",
      errorMessage: "not logged in",
    });

    await expect(resolveRootRoute()).resolves.toBe(ROUTES.login);
    expect(mockRepositoryConstructor).toHaveBeenCalledTimes(1);
  });

  test("returns login route when user is missing", async () => {
    mockEnforceDomainOnCurrentSession.mockResolvedValueOnce({
      valid: true,
      hasUser: false,
      errorCode: null,
      errorMessage: null,
    });

    await expect(resolveRootRoute()).resolves.toBe(ROUTES.login);
  });

  test("returns dashboard route when session is valid and user exists", async () => {
    mockEnforceDomainOnCurrentSession.mockResolvedValueOnce({
      valid: true,
      hasUser: true,
      errorCode: null,
      errorMessage: null,
    });

    await expect(resolveRootRoute()).resolves.toBe(ROUTES.dashboard);
  });
});
