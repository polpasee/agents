import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

/** Throws on every render unless `shouldThrow` is false. */
function ThrowingComponent({
  message,
  shouldThrow = true,
}: {
  message: string;
  shouldThrow?: boolean;
}): React.ReactNode {
  if (shouldThrow) throw new Error(message);
  return <div>{message}</div>;
}

const MAX_RETRIES = 3;

describe("ErrorBoundary", () => {
  // Suppress console.error for expected errors
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>safe content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe content")).toBeDefined();
  });

  it("catches error and shows default fallback", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="test error" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("test error")).toBeDefined();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowingComponent message="oops" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeDefined();
  });

  it("shows Try Again button on the first error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Try Again")).toBeDefined();
  });

  it("shows the error message from the thrown Error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="specific failure" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("specific failure")).toBeDefined();
  });

  it(`replaces Try Again with reload message after ${MAX_RETRIES} retries`, () => {
    // The child always throws, so every retry immediately re-enters error state.
    render(
      <ErrorBoundary>
        <ThrowingComponent message="persistent error" />
      </ErrorBoundary>,
    );

    for (let i = 0; i < MAX_RETRIES; i++) {
      expect(screen.getByText("Try Again")).toBeDefined();
      fireEvent.click(screen.getByText("Try Again"));
    }

    // After MAX_RETRIES clicks the retry button must be gone
    expect(screen.queryByText("Try Again")).toBeNull();
    expect(screen.getByText("Repeated errors — reload the page")).toBeDefined();
  });

  it("still shows the error heading after hitting the retry cap", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="repeat" />
      </ErrorBoundary>,
    );

    for (let i = 0; i < MAX_RETRIES; i++) {
      fireEvent.click(screen.getByText("Try Again"));
    }

    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("renders children again when child stops throwing (recovery path)", () => {
    // Use a ref-like object so the throwing flag is readable by the component
    // without triggering a new render cycle before we're ready.
    const state = { shouldThrow: true };

    function RecoverableChild() {
      if (state.shouldThrow) throw new Error("recoverable-error");
      return <div>recovered content</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <RecoverableChild />
      </ErrorBoundary>,
    );

    // Boundary is now in error state
    expect(screen.getByText("Try Again")).toBeDefined();

    // Stop the child from throwing, then click Try Again to reset boundary state
    state.shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));

    // Force a re-render so React picks up the new child output
    rerender(
      <ErrorBoundary>
        <RecoverableChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("recovered content")).toBeDefined();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("increments the retry counter on each click so cap is exact", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="count test" />
      </ErrorBoundary>,
    );

    // Click exactly MAX_RETRIES - 1 times → button still present
    for (let i = 0; i < MAX_RETRIES - 1; i++) {
      fireEvent.click(screen.getByText("Try Again"));
    }
    expect(screen.getByText("Try Again")).toBeDefined();

    // One more click hits the cap
    fireEvent.click(screen.getByText("Try Again"));
    expect(screen.queryByText("Try Again")).toBeNull();
  });
});
