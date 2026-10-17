import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RiskLevel } from './types';

export function MetricTooltip({
  children,
  description,
  warning = false,
  level,
}: {
  children: ReactNode;
  description: string;
  warning?: boolean;
  level?: RiskLevel;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancelClose() {
    clearTimeout(closeTimer.current);
  }
  function show() {
    cancelClose();
    setOpen(true);
  }
  function dismiss() {
    cancelClose();
    setOpen(false);
    setPosition(null);
  }
  function leave() {
    // Allow the pointer to cross the small gap into the description.
    cancelClose();
    if (!focused.current) closeTimer.current = setTimeout(dismiss, 120);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    function place() {
      if (!trigger.current || !tooltip.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const scrollport = trigger.current.closest('.route-options')?.getBoundingClientRect();
      const visibleTop = Math.max(0, scrollport?.top ?? 0);
      const visibleBottom = Math.min(window.innerHeight, scrollport?.bottom ?? window.innerHeight);
      if (anchor.bottom <= visibleTop || anchor.top >= visibleBottom) {
        dismiss();
        return;
      }
      const tip = tooltip.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - tip.width - 8));
      const above = anchor.top - tip.height - 8;
      const top =
        above >= 8 ? above : Math.min(anchor.bottom + 8, window.innerHeight - tip.height - 8);
      setPosition({ left, top: Math.max(8, top) });
    }
    function schedulePlace() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    place();
    window.addEventListener('resize', schedulePlace);
    document.addEventListener('scroll', schedulePlace, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePlace);
      document.removeEventListener('scroll', schedulePlace, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);
  return (
    <span
      className={`route-stat${warning ? ' route-stat-warning' : ''}${level ? ` risk-stat risk-${level}` : ''}`}
      onMouseEnter={show}
      onMouseLeave={leave}
    >
      <button
        ref={trigger}
        type="button"
        className="route-stat-trigger"
        aria-describedby={open ? id : undefined}
        onFocus={() => {
          focused.current = true;
          show();
        }}
        onBlur={() => {
          focused.current = false;
          dismiss();
        }}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dismiss();
        }}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <span
              ref={tooltip}
              id={id}
              role="tooltip"
              className="metric-tooltip"
              style={{
                left: position?.left,
                top: position?.top,
                visibility: position ? 'visible' : 'hidden',
              }}
              onMouseEnter={show}
              onMouseLeave={leave}
            >
              {description}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
