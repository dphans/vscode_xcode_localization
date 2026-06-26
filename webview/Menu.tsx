import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon } from "./icons";

/** Viewport coordinates where a menu should open (a button corner or cursor). */
export interface MenuPos {
  x: number;
  y: number;
}

/**
 * A floating menu used by both the row/cell kebab buttons and the right-click
 * context menus. Positioned with `position: fixed` at `pos`, nudged back inside
 * the viewport if it would overflow. Closes on outside click or Escape.
 */
export function Menu({
  pos,
  onClose,
  children,
  ariaLabel,
}: {
  pos: MenuPos;
  onClose(): void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<MenuPos>(pos);

  // Keep the menu fully on screen: flip/clamp once it has measured its size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let { x, y } = pos;
    const margin = 6;
    if (x + r.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - r.width - margin);
    }
    if (y + r.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - r.height - margin);
    }
    setResolved({ x, y });
  }, [pos]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ left: resolved.x, top: resolved.y }}
    >
      {children}
    </div>
  );
}

/** A single menu row. `checked` shows a leading checkmark (else `icon`/blank). */
export function MenuItem({
  label,
  icon,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={!!checked}
      className="ctx-item"
      disabled={disabled}
      onClick={() => onSelect()}
    >
      <span className="ctx-icon">
        {checked ? <CheckIcon size={13} /> : icon}
      </span>
      <span className="ctx-label">{label}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ctx-sep" role="separator" />;
}
