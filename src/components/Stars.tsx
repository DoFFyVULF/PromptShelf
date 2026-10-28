import { useState } from "react";
import { Star } from "lucide-react";

interface StarsProps {
  value: number;
  size?: number;
  readonly?: boolean;
  onChange?: (v: number) => void;
}

export function Stars({ value, size = 15, readonly = false, onChange }: StarsProps) {
  const [hover, setHover] = useState(0);
  const shown = readonly ? value : hover || value;

  if (readonly) {
    if (value <= 0) return null;
    return (
      <span className="inline-flex items-center gap-0.5" title={String(value)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={size}
            className={i <= value ? "fill-ink text-ink" : "fill-transparent text-hairline"}
            strokeWidth={1.5}
          />
        ))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i}`}
          className="press cursor-pointer rounded-full p-0.5"
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange?.(value === i ? 0 : i)}
        >
          <Star
            size={size + 3}
            strokeWidth={1.5}
            className={
              i <= shown ? "fill-ink text-ink transition-colors" : "fill-transparent text-faint transition-colors hover:text-muted"
            }
          />
        </button>
      ))}
    </span>
  );
}
