import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  width?: number;
  children: ReactNode;
}

export function Dialog({ open, onClose, labelledBy, width = 680, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="anim-fade absolute inset-0 bg-zinc-950/35" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ width: `min(${width}px, 94vw)` }}
        className="anim-panel relative max-h-[88vh] overflow-hidden rounded-panel bg-card shadow-panel"
      >
        {children}
      </div>
    </div>
  );
}

export function DialogCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button type="button" className="btn-icon press cursor-pointer" aria-label={label} onClick={onClose}>
      <X size={17} />
    </button>
  );
}
