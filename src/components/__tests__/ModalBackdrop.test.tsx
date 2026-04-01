import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModalBackdrop } from "../ModalBackdrop";

describe("ModalBackdrop", () => {
  it("renders children", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <div>child content</div>
      </ModalBackdrop>
    );
    expect(screen.getByText("child content")).toBeDefined();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalBackdrop onClose={onClose}>
        <div>child content</div>
      </ModalBackdrop>
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
      </ModalBackdrop>
    );
    fireEvent.click(screen.getByText("child content"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
