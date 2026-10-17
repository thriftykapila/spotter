import { useId, useState, type ReactNode } from 'react';

export function MetricTooltip({
  children,
  description,
  warning = false,
}: {
  children: ReactNode;
  description: string;
  warning?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <span
      className={`route-stat${warning ? ' route-stat-warning' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!focused) setOpen(false);
      }}
    >
      <button
        type="button"
        className="route-stat-trigger"
        aria-describedby={open ? id : undefined}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        {children}
      </button>
      {open ? (
        <span id={id} role="tooltip" className="metric-tooltip">
          {description}
        </span>
      ) : null}
    </span>
  );
}
