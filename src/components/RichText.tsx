import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../i18n";
import { useToast } from "./Toasts";

/** Collapsed height for long descriptions, like the CivitAI spoiler. */
const CLAMP = 420;

interface RichTextProps {
  /** Sanitised rich HTML straight from the backend. */
  html: string;
  className?: string;
}

/** Renders a lora description HTML with the shelf's token styling, opens
 * its links in the system browser and folds very long text behind a
 * "Show more" control with a fade, mirroring CivitAI's spoiler. */
export function RichText({ html, className = "" }: RichTextProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const body = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // layout effect so the very first paint is already correct: long text
  // renders clamped (no flash), short text unclamps before it shows
  useEffect(() => {
    setExpanded(false);
    setClamped(true);
    const el = body.current;
    if (el) setClamped(el.scrollHeight > CLAMP + 48);
  }, [html]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (!href) return;
      void api.openUrl(href).catch(() => toast(t("toast.error"), "error"));
    },
    [t, toast]
  );

  const collapsed = clamped && !expanded;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={body}
        onClick={handleClick}
        className="rich-text select-text"
        style={collapsed ? { maxHeight: CLAMP, overflow: "hidden" } : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {collapsed && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{ backgroundImage: "linear-gradient(to top, var(--color-card), transparent)" }}
        />
      )}
      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="press mt-1 flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-[11.5px] font-medium text-faint transition-colors hover:bg-parchment hover:text-ink"
        >
          {expanded ? t("lora.showLess") : t("lora.showMore")}
          <ChevronDown size={12.5} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
