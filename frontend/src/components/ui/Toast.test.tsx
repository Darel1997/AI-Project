import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function TestConsumer({ onMount }: { onMount: (t: ReturnType<typeof useToast>) => void }) {
  const toast = useToast();
  onMount(toast);
  return null;
}

describe("Toast", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows a success toast with the provided title and description", () => {
    let t!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <TestConsumer onMount={api => { t = api; }} />
      </ToastProvider>
    );

    act(() => { t.success("Saved", "Your changes are live"); });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your changes are live")).toBeInTheDocument();
  });

  it("uses role=alert for errors and role=status for others", () => {
    let t!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <TestConsumer onMount={api => { t = api; }} />
      </ToastProvider>
    );

    act(() => { t.error("Bad thing happened"); });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => { t.success("Good thing"); });
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("auto-dismisses after the default 5s", () => {
    let t!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <TestConsumer onMount={api => { t = api; }} />
      </ToastProvider>
    );

    act(() => { t.info("Heads up"); });
    expect(screen.getByText("Heads up")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
  });

  it("errors stay longer (7s)", () => {
    let t!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <TestConsumer onMount={api => { t = api; }} />
      </ToastProvider>
    );

    act(() => { t.error("Oops"); });
    act(() => { vi.advanceTimersByTime(5100); });
    // Still visible after 5s
    expect(screen.getByText("Oops")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("Oops")).not.toBeInTheDocument();
  });

  it("stacks multiple toasts", () => {
    let t!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <TestConsumer onMount={api => { t = api; }} />
      </ToastProvider>
    );

    act(() => {
      t.success("First");
      t.success("Second");
      t.success("Third");
    });

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
  });
});
