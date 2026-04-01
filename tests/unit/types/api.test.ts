import { createErrorResponse, createSuccessResponse } from "@/types/api";

describe("api response helpers", () => {
  test("createSuccessResponse returns data and null error", () => {
    expect(createSuccessResponse({ ok: true })).toEqual({
      data: { ok: true },
      error: null,
      meta: undefined,
    });
  });

  test("createSuccessResponse includes correlation id when provided", () => {
    expect(createSuccessResponse({ ok: true }, "cid-1")).toEqual({
      data: { ok: true },
      error: null,
      meta: { correlationId: "cid-1" },
    });
  });

  test("createErrorResponse returns structured error", () => {
    expect(createErrorResponse("BAD", "Something failed")).toEqual({
      data: null,
      error: { code: "BAD", message: "Something failed" },
      meta: undefined,
    });
  });

  test("createErrorResponse includes correlation id when provided", () => {
    expect(createErrorResponse("BAD", "Something failed", "cid-2")).toEqual({
      data: null,
      error: { code: "BAD", message: "Something failed" },
      meta: { correlationId: "cid-2" },
    });
  });
});
