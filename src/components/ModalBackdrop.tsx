"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalBackdropProps {
  onClose: () => void;
  children: ReactNode;
}

/** Shared modal backdrop with click-outside-to-close, Escape key, and focus trap */
export function ModalBackdrop({ onClose, children }: ModalBackdropProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = backdropRef.current;
    if (!el) return;

    // Focus the backdrop to capture keyboard events
    el.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Focus trap: cycle Tab within the modal
      if (e.key === "Tab") {
        const focusable = el!.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center outline-none"
      style={{ background: "rgba(0, 0, 0, 0.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
