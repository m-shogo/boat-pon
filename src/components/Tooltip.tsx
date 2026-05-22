import { useState, type ReactNode } from "react";

type Props = {
  label: ReactNode;
  hint: string;
  className?: string;
};

export function Tooltip({ label, hint, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`tooltipHost ${className ?? ""}`}>
      <span
        className="tooltipTrigger"
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label}
        <span className="tooltipMark" aria-hidden>?</span>
      </span>
      {open && (
        <span className="tooltipBubble" role="tooltip">
          {hint}
        </span>
      )}
    </span>
  );
}
