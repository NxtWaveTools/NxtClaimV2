import { downloadFileWithSemanticName } from "@/lib/files/download-file-with-semantic-name";

describe("downloadFileWithSemanticName", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalCreateElement = document.createElement.bind(document);

  let lastCreatedAnchor: HTMLAnchorElement | null = null;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => "blob:semantic-download");
    URL.revokeObjectURL = jest.fn();
    lastCreatedAnchor = null;

    jest.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        lastCreatedAnchor = element as HTMLAnchorElement;
      }

      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  test("keeps the source extension for pdf files", async () => {
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchMock = jest.fn(
      async () =>
        new Response(new Blob(["pdf-content"], { type: "application/pdf" }), {
          status: 200,
        }),
    );
    global.fetch = fetchMock as typeof fetch;

    await downloadFileWithSemanticName(
      "https://example.com/storage/claims/receipt-file.pdf?token=abc",
      "CLM-001-EXP",
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(lastCreatedAnchor?.download).toBe("CLM-001-EXP.pdf");
  });

  test("falls back to blob mime extension when url has no extension", async () => {
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchMock = jest.fn(
      async () =>
        new Response(new Blob(["image-content"], { type: "image/png" }), {
          status: 200,
        }),
    );
    global.fetch = fetchMock as typeof fetch;

    await downloadFileWithSemanticName(
      "https://example.com/storage/claims/signed-resource",
      "CLM-002-BNK",
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(lastCreatedAnchor?.download).toBe("CLM-002-BNK.png");
  });
});
