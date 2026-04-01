import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

function ThrowingComponent({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}

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
      </ErrorBoundary>
    );
    expect(screen.getByText("safe content")).toBeDefined();
  });

  it("catches error and shows default fallback", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="test error" />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("test error")).toBeDefined();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowingComponent message="oops" />
      </ErrorBoundary>
    );
    expect(screen.getByText("custom fallback")).toBeDefined();
  });
});
