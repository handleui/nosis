"use client";

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const DRAG_HITBOX_WIDTH = 20;
const COLLAPSED_DRAG_THRESHOLD = 12;

const clamp = (min: number, value: number, max: number) =>
  Math.min(max, Math.max(min, value));

export interface AppShellGridHandle {
  setLeftWidth: (width: number) => void;
  readonly leftWidth: number;
}

interface AppShellGridProps {
  left: ReactNode;
  center: ReactNode;
  initialLeft: number;
  minLeft: number;
  minOpenLeft: number;
  maxLeft: number;
  collapsedLeft: number;
  isCollapsed: boolean;
  allowUserResize?: boolean;
  onLeftWidthChange?: (left: number) => void;
  ref?: Ref<AppShellGridHandle>;
}

export default function AppShellGrid({
  left,
  center,
  initialLeft,
  minLeft,
  minOpenLeft,
  maxLeft,
  collapsedLeft,
  isCollapsed,
  allowUserResize = true,
  onLeftWidthChange,
  ref,
}: AppShellGridProps) {
  const initialClampedLeft = clamp(minLeft, initialLeft, maxLeft);
  const [leftWidth, setLeftWidthState] = useState(initialClampedLeft);
  const leftWidthRef = useRef(initialClampedLeft);
  const dragRef = useRef<{ startX: number; startLeft: number } | null>(null);

  const setLeftWidth = useCallback(
    (next: number) => {
      const clamped = clamp(minLeft, next, maxLeft);
      leftWidthRef.current = clamped;
      setLeftWidthState(clamped);
      onLeftWidthChange?.(clamped);
    },
    [maxLeft, minLeft, onLeftWidthChange]
  );

  useImperativeHandle(
    ref,
    () => ({
      setLeftWidth,
      get leftWidth() {
        return leftWidthRef.current;
      },
    }),
    [setLeftWidth]
  );

  const startDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!allowUserResize) {
        return;
      }

      event.preventDefault();
      dragRef.current = {
        startX: event.clientX,
        startLeft: leftWidthRef.current,
      };

      const onMove = (moveEvent: globalThis.PointerEvent) => {
        const state = dragRef.current;
        if (!state) {
          return;
        }
        const next = state.startLeft + (moveEvent.clientX - state.startX);

        if (isCollapsed) {
          if (next <= collapsedLeft + COLLAPSED_DRAG_THRESHOLD) {
            setLeftWidth(collapsedLeft);
            return;
          }

          setLeftWidth(clamp(minOpenLeft, next, maxLeft));
          return;
        }

        setLeftWidth(clamp(minOpenLeft, next, maxLeft));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragRef.current = null;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [
      allowUserResize,
      collapsedLeft,
      isCollapsed,
      maxLeft,
      minOpenLeft,
      setLeftWidth,
    ]
  );

  return (
    <div
      className="relative grid h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      style={
        {
          gridTemplateColumns: `${leftWidth}px 1fr`,
        } as CSSProperties
      }
    >
      <aside className="min-h-0 min-w-0 overflow-hidden border-[#f1f1f2] border-r">
        <div className="h-full min-h-0 min-w-0 overflow-hidden">{left}</div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden">{center}</main>

      {allowUserResize ? (
        <div
          className="absolute top-0 z-20 h-full"
          onPointerDown={startDrag}
          style={{
            left: `${leftWidth - DRAG_HITBOX_WIDTH / 2}px`,
            width: `${DRAG_HITBOX_WIDTH}px`,
            cursor: "col-resize",
          }}
        />
      ) : null}
    </div>
  );
}
