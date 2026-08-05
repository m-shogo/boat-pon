import { useId, useState, type ReactNode } from "react";

type Props = {
  label: ReactNode;
  hint: ReactNode;
  className?: string;
  accessibleLabel?: string;
};

export function Tooltip({ label, hint, className, accessibleLabel }: Props) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className={`tooltipHost ${className ?? ""}`}>
      <button
        type="button"
        className="tooltipTrigger"
        aria-label={accessibleLabel}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.focus();
          }
        }}
      >
        {label}
        <span className="tooltipMark" aria-hidden>?</span>
      </button>
      {open && (
        <span className="tooltipBubble" id={tooltipId} role="tooltip">
          {hint}
        </span>
      )}
    </span>
  );
}
