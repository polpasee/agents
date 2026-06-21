import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AnnotationOverlay } from "../AnnotationOverlay";

describe("AnnotationOverlay — displaying existing annotations", () => {
  beforeEach(() => {
    useAgentStore.setState({ annotations: new Map() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for annotations when none exist for the agent", () => {
    render(<AnnotationOverlay agentId="agent-a" />);
    // No annotation count label visible
    expect(screen.queryByText(/annotation/)).toBeNull();
  });

  it("displays existing annotations for the given agentId", () => {
    const ann = {
      id: "ann-1",
      targetId: "agent-a",
      targetType: "agent" as const,
      text: "This is a note",
      author: "viewer",
      timestamp: Date.now(),
    };
    useAgentStore.setState({
      annotations: new Map([["ann-1", ann]]),
    });
    render(<AnnotationOverlay agentId="agent-a" />);
    expect(screen.getByText("This is a note")).toBeDefined();
  });

  it("shows count badge for multiple annotations", () => {
    const anns = new Map([
      [
        "ann-1",
        {
          id: "ann-1",
          targetId: "agent-a",
          targetType: "agent" as const,
          text: "Note 1",
          author: "viewer",
          timestamp: Date.now(),
        },
      ],
      [
        "ann-2",
        {
          id: "ann-2",
          targetId: "agent-a",
          targetType: "agent" as const,
          text: "Note 2",
          author: "viewer",
          timestamp: Date.now(),
        },
      ],
    ]);
    useAgentStore.setState({ annotations: anns });
    render(<AnnotationOverlay agentId="agent-a" />);
    expect(screen.getByText("2 annotations")).toBeDefined();
  });

  it("shows singular 'annotation' when count is 1", () => {
    const anns = new Map([
      [
        "ann-1",
        {
          id: "ann-1",
          targetId: "agent-a",
          targetType: "agent" as const,
          text: "Single note",
          author: "viewer",
          timestamp: Date.now(),
        },
      ],
    ]);
    useAgentStore.setState({ annotations: anns });
    render(<AnnotationOverlay agentId="agent-a" />);
    expect(screen.getByText("1 annotation")).toBeDefined();
  });

  it("does not show annotations for a different agentId", () => {
    const ann = {
      id: "ann-1",
      targetId: "other-agent",
      targetType: "agent" as const,
      text: "Other note",
      author: "viewer",
      timestamp: Date.now(),
    };
    useAgentStore.setState({ annotations: new Map([["ann-1", ann]]) });
    render(<AnnotationOverlay agentId="agent-a" />);
    expect(screen.queryByText("Other note")).toBeNull();
  });
});

describe("AnnotationOverlay — remove annotation", () => {
  beforeEach(() => {
    useAgentStore.setState({ annotations: new Map() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls DELETE /api/annotations/:id when remove button is activated", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }) as Response);

    const ann = {
      id: "ann-remove-1",
      targetId: "agent-a",
      targetType: "agent" as const,
      text: "To be removed",
      author: "viewer",
      timestamp: Date.now(),
    };
    useAgentStore.setState({ annotations: new Map([["ann-remove-1", ann]]) });
    render(<AnnotationOverlay agentId="agent-a" />);

    // The remove button is hidden by group-hover; we click via fireEvent
    const removeBtn = document.querySelector(
      'button[title="Remove annotation"]',
    ) as HTMLElement;
    expect(removeBtn).not.toBeNull();
    fireEvent.click(removeBtn!);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("ann-remove-1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("sets error when DELETE fails with non-404 status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, {
        status: 500,
        statusText: "Internal Server Error",
      }) as Response,
    );

    const ann = {
      id: "ann-err-1",
      targetId: "agent-a",
      targetType: "agent" as const,
      text: "Will fail on remove",
      author: "viewer",
      timestamp: Date.now(),
    };
    useAgentStore.setState({ annotations: new Map([["ann-err-1", ann]]) });
    render(<AnnotationOverlay agentId="agent-a" />);

    const removeBtn = document.querySelector(
      'button[title="Remove annotation"]',
    ) as HTMLElement;
    fireEvent.click(removeBtn!);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });
  });
});

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

    const input = screen.getByPlaceholderText(
      "Add annotation...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test note" } });
    fireEvent.click(screen.getByText("Add"));

    // waitFor retries until the async state update has been applied to the DOM
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("boom");
    });

    // Input text is retained on failure
    expect(input.value).toBe("test note");
  });

  it("clears the error message when the user types again", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }) as Response,
    );

    render(<AnnotationOverlay agentId="agent-a" />);
    const input = screen.getByPlaceholderText(
      "Add annotation...",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "test note" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });

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
    const input = screen.getByPlaceholderText(
      "Add annotation...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "happy path" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(input.value).toBe("");
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
