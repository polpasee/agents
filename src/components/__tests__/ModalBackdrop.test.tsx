import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModalBackdrop } from "../ModalBackdrop";

describe("ModalBackdrop", () => {
  it("renders children", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <div>child content</div>
      </ModalBackdrop>,
    );
    expect(screen.getByText("child content")).toBeDefined();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalBackdrop onClose={onClose}>
        <div>child content</div>
      </ModalBackdrop>,
    );
    // Click the backdrop div (the outer wrapper)
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking children", () => {
    const onClose = vi.fn();
    render(
      <ModalBackdrop onClose={onClose}>
        <div>child content</div>
      </ModalBackdrop>,
    );
    fireEvent.click(screen.getByText("child content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalBackdrop onClose={onClose}>
        <div>child</div>
      </ModalBackdrop>,
    );
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.keyDown(backdrop, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for non-Escape keydown events", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalBackdrop onClose={onClose}>
        <div>child</div>
      </ModalBackdrop>,
    );
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.keyDown(backdrop, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has role='dialog' and aria-modal='true'", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <div>child</div>
      </ModalBackdrop>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("Tab key with no focusable elements does not call onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalBackdrop onClose={onClose}>
        <div>no focusable elements</div>
      </ModalBackdrop>,
    );
    const backdrop = container.firstChild as HTMLElement;
    // Tab with no focusable children — should be a no-op (not crash or close)
    fireEvent.keyDown(backdrop, { key: "Tab" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps focus from last to first on Tab", () => {
    const onClose = vi.fn();
    render(
      <ModalBackdrop onClose={onClose}>
        <div>
          <button id="btn1">First</button>
          <button id="btn2">Last</button>
        </div>
      </ModalBackdrop>,
    );
    const lastBtn = screen.getByText("Last");
    lastBtn.focus();
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, {
      key: "Tab",
      shiftKey: false,
    });
    // Wraps to first: no crash and onClose not called
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps focus from first to last on Shift+Tab", () => {
    const onClose = vi.fn();
    render(
      <ModalBackdrop onClose={onClose}>
        <div>
          <button id="btn1">First</button>
          <button id="btn2">Last</button>
        </div>
      </ModalBackdrop>,
    );
    const firstBtn = screen.getByText("First");
    firstBtn.focus();
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, {
      key: "Tab",
      shiftKey: true,
    });
    // Wraps to last: no crash and onClose not called
    expect(onClose).not.toHaveBeenCalled();
  });
});
