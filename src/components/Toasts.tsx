import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastContextValue {
  toast: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-2), { id, text, kind }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="anim-toast pointer-events-auto flex items-center gap-2 rounded-full bg-ink py-2.5 pr-4 pl-3.5 text-[13px] font-medium text-white shadow-[0_12px_40px_-8px_rgb(0_0_0/0.45)]"
          >
            {t.kind === "success" && <CheckCircle2 size={15} className="text-zinc-300" />}
            {t.kind === "error" && <AlertCircle size={15} className="text-red-300" />}
            {t.kind === "info" && <Info size={15} className="text-zinc-300" />}
            <span className="max-w-[420px] truncate">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
