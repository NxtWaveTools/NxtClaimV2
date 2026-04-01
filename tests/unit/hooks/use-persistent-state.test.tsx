import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { usePersistentState } from "@/hooks/use-persistent-state";

function PersistentStateHarness(props: { storageKey: string; initialValue: string }) {
  const [value, setValue] = usePersistentState(props.storageKey, props.initialValue);

  return (
    <div>
      <span data-testid="value">{value}</span>
      <button type="button" onClick={() => setValue("updated")}>
        Update
      </button>
    </div>
  );
}

describe("usePersistentState", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("restores value from localStorage on mount", async () => {
    localStorage.setItem("prefs:key", JSON.stringify("restored"));

    render(<PersistentStateHarness storageKey="prefs:key" initialValue="initial" />);

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("restored");
    });
  });

  test("persists changes with debounce", async () => {
    render(<PersistentStateHarness storageKey="prefs:key" initialValue="initial" />);

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(localStorage.getItem("prefs:key")).toBe(JSON.stringify("updated"));
  });

  test("keeps initial value when localStorage contains invalid JSON", async () => {
    localStorage.setItem("prefs:key", "{");

    render(<PersistentStateHarness storageKey="prefs:key" initialValue="initial" />);

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("initial");
    });
  });
});
