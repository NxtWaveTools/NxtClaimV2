import { logger } from "@/core/infra/logging/logger";

function parsePayloadFromSpy(spy: jest.SpyInstance): Record<string, unknown> {
  const call = spy.mock.calls[0];
  return JSON.parse(String(call[0])) as Record<string, unknown>;
}

describe("logger", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("debug logs to console.log as structured JSON", () => {
    logger.debug("debug.event", { key: "value" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const row = parsePayloadFromSpy(logSpy);
    expect(row.level).toBe("debug");
    expect(row.event).toBe("debug.event");
    expect(row.payload).toEqual({ key: "value" });
    expect(typeof row.timestamp).toBe("string");
  });

  test("info logs to console.log", () => {
    logger.info("info.event", { count: 2 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const row = parsePayloadFromSpy(logSpy);
    expect(row.level).toBe("info");
    expect(row.event).toBe("info.event");
  });

  test("warn logs to console.warn", () => {
    logger.warn("warn.event", { important: true });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const row = parsePayloadFromSpy(warnSpy);
    expect(row.level).toBe("warn");
    expect(row.event).toBe("warn.event");
  });

  test("error logs to console.error", () => {
    logger.error("error.event", { fatal: true });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const row = parsePayloadFromSpy(errorSpy);
    expect(row.level).toBe("error");
    expect(row.event).toBe("error.event");
  });

  test("maskEmail masks valid emails and handles invalid input", () => {
    expect(logger.maskEmail("alice@example.com")).toBe("a***@example.com");
    expect(logger.maskEmail("invalid-email")).toBeNull();
    expect(logger.maskEmail("")).toBeNull();
    expect(logger.maskEmail(null)).toBeNull();
  });
});
