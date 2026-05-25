import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AnnotationOverlay } from "../AnnotationOverlay";

describe("AnnotationOverlay — F7 error handling", () => {
  beforeEach(() => {
    useAgentStore.setState({ annotations: new Map() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retains input text and shows an error message when POST fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }) as Response,
    );

    render(<AnnotationOverlay agentId="agent-a" />);

    const input = screen.getByPlaceholderText("Add annotation...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test note" } });
    fireEvent.click(screen.getByText("Add"));

    // Flush microtasks for the awaited fetch
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Input text is retained on failure
    expect(input.value).toBe("test note");
    // Error message rendered
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("clears the error message when the user types again", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }) as Response,
    );

    render(<AnnotationOverlay agentId="agent-a" />);
    const input = screen.getByPlaceholderText("Add annotation...") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "test note" } });
    fireEvent.click(screen.getByText("Add"));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByRole("alert")).not.toBeNull();

    // Typing again clears the error
    fireEvent.change(input, { target: { value: "test note more" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears input and error on successful POST", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as Response,
    );

    render(<AnnotationOverlay agentId="agent-a" />);
    const input = screen.getByPlaceholderText("Add annotation...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "happy path" } });
    fireEvent.click(screen.getByText("Add"));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(input.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
