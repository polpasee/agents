"use client";

import type { ReactNode } from "react";

interface ModalBackdropProps {
  onClose: () => void;
  children: ReactNode;
}

/** Shared modal backdrop with click-outside-to-close behavior */
export function ModalBackdrop({ onClose, children }: ModalBackdropProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}
