"use client";

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface ResizableGridHandle {
  setWidths: (left: number, right: number, duration?: number) => void;
  getWidths: () => { left: number; right: number };
}

interface ResizableGridProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  initialLeft?: number;
  initialRight?: number;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
  allowUserResize?: boolean;
  allowLeftResize?: boolean;
  allowRightResize?: boolean;
  onWidthsChange?: (widths: { left: number; right: number }) => void;
}

const clamp = (min: number, value: number, max: number) =>
  Math.min(max, Math.max(min, value));

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const CONSTRAINTS = {
  left: { min: 0, max: 360, initial: 240 },
  right: { min: 0, max: 600, initial: 300 },
} as const;

const COLLAPSE_THRESHOLD = 200;
const DRAG_HANDLE_WIDTH = 4;
const DRAG_HANDLE_OFFSET = DRAG_HANDLE_WIDTH / 2;

const normalizeProgress = (width: number, threshold: number) =>
  Math.min(1, Math.max(0, width / threshold));

const computeScale = (width: number, threshold: number) =>
  0.95 + 0.05 * normalizeProgress(width, threshold);

const snapToThreshold = (width: number, side: "left" | "right") => {
  const initial = CONSTRAINTS[side].initial;
  if (width < COLLAPSE_THRESHOLD) {
    return 0;
  }
  if (width < initial) {
    return initial;
  }
  return width;
};

const applySidebarStyles = (
  el: HTMLElement | null,
  width: number,
  handleEl: HTMLElement | null,
  side: "left" | "right"
) => {
  if (handleEl) {
    handleEl.style[side] = `${width - DRAG_HANDLE_OFFSET}px`;
  }
  if (el) {
    const threshold = CONSTRAINTS[side].initial;
    el.style.opacity = String(normalizeProgress(width, threshold));
    el.style.transform = `scale(${computeScale(width, threshold)})`;
  }
};

interface DragHandleProps {
  side: "left" | "right";
  enabled: boolean;
  isActive: boolean;
  position: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const DragHandle = ({
  side,
  enabled,
  isActive,
  position,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: DragHandleProps) => {
  let cursor: CSSProperties["cursor"] = "default";
  if (enabled) {
    cursor = isActive ? "grabbing" : "grab";
  }

  return (
    <div
      className="drag-handle"
      data-active={isActive ? "" : undefined}
      data-side={side}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        [side]: `${position - DRAG_HANDLE_OFFSET}px`,
        cursor,
        pointerEvents: enabled ? ("auto" as const) : ("none" as const),
      }}
    />
  );
};

interface SidebarPanelProps {
  side: "left" | "right";
  width: number;
  children: ReactNode;
}

const SidebarPanel = ({ side, width, children }: SidebarPanelProps) => {
  const isLeft = side === "left";
  const constraint = CONSTRAINTS[side];
  return (
    <aside className="relative overflow-hidden" style={{ minWidth: 0 }}>
      <div
        className={`scrollbar-hidden absolute top-0 ${isLeft ? "left-0" : "right-0 flex flex-col"} h-full overflow-y-auto overscroll-none`}
        data-sidebar-inner={side}
        style={{
          width: "100%",
          minWidth: `${constraint.initial}px`,
          opacity: normalizeProgress(width, constraint.initial),
          transform: `scale(${computeScale(width, constraint.initial)})`,
          transformOrigin: `${side} center`,
        }}
      >
        {children}
      </div>
    </aside>
  );
};

const useDragResize = (
  containerRef: RefObject<HTMLDivElement | null>,
  initialLeft: number,
  initialRight: number,
  onWidthsChange?: (widths: { left: number; right: number }) => void
) => {
  const [activeHandle, setActiveHandle] = useState<"left" | "right" | null>(
    null
  );
  const [hitboxActive, setHitboxActive] = useState({
    left: initialLeft === 0,
    right: initialRight === 0,
  });
  const dragRef = useRef({ startX: 0, startLeftW: 0, startRightW: 0 });
  const widthRef = useRef<{ left: number; right: number }>({
    left: initialLeft,
    right: initialRight,
  });
  const rafRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onWidthsChangeRef = useRef(onWidthsChange);
  const elementsRef = useRef<{
    leftHandle: HTMLElement | null;
    rightHandle: HTMLElement | null;
    leftInner: HTMLElement | null;
    rightInner: HTMLElement | null;
  }>({
    leftHandle: null,
    rightHandle: null,
    leftInner: null,
    rightInner: null,
  });

  useEffect(() => {
    onWidthsChangeRef.current = onWidthsChange;
  }, [onWidthsChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const query = <T extends HTMLElement>(selector: string) =>
      el.querySelector<T>(selector);

    elementsRef.current = {
      leftHandle: query(".drag-handle[data-side='left']"),
      rightHandle: query(".drag-handle[data-side='right']"),
      leftInner: query("[data-sidebar-inner='left']"),
      rightInner: query("[data-sidebar-inner='right']"),
    };
  }, [containerRef]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      cleanupRef.current?.();
    };
  }, []);

  const applyWidths = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const { left: lw, right: rw } = widthRef.current;
    el.style.gridTemplateColumns = `${lw}px 1fr ${rw}px`;
    el.style.setProperty(
      "--left-progress",
      String(normalizeProgress(lw, CONSTRAINTS.left.initial))
    );
    el.style.setProperty(
      "--right-progress",
      String(normalizeProgress(rw, CONSTRAINTS.right.initial))
    );

    el.toggleAttribute("data-left-open", lw > 0);
    el.toggleAttribute("data-right-open", rw > 0);

    const { leftHandle, rightHandle, leftInner, rightInner } =
      elementsRef.current;
    applySidebarStyles(leftInner, lw, leftHandle, "left");
    applySidebarStyles(rightInner, rw, rightHandle, "right");
    onWidthsChangeRef.current?.({ left: lw, right: rw });
  }, [containerRef]);

  const updateWidthOnDrag = useCallback(
    (side: "left" | "right", delta: number) => {
      if (side === "left") {
        widthRef.current.left = clamp(
          CONSTRAINTS.left.min,
          dragRef.current.startLeftW + delta,
          CONSTRAINTS.left.max
        );
      } else {
        widthRef.current.right = clamp(
          CONSTRAINTS.right.min,
          dragRef.current.startRightW - delta,
          CONSTRAINTS.right.max
        );
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyWidths);
    },
    [applyWidths]
  );

  const animateToWidths = useCallback(
    (targetLeft: number, targetRight: number, duration = 350) => {
      const isAlreadyAtTarget =
        widthRef.current.left === targetLeft &&
        widthRef.current.right === targetRight;

      if (isAlreadyAtTarget) {
        setHitboxActive({ left: targetLeft === 0, right: targetRight === 0 });
        return;
      }

      const startLeft = widthRef.current.left;
      const startRight = widthRef.current.right;
      const startTime = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const ease = easeOutCubic(progress);
        widthRef.current.left = startLeft + (targetLeft - startLeft) * ease;
        widthRef.current.right = startRight + (targetRight - startRight) * ease;
        applyWidths();

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        widthRef.current = { left: targetLeft, right: targetRight };
        applyWidths();
        setHitboxActive({ left: targetLeft === 0, right: targetRight === 0 });
      };

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    },
    [applyWidths]
  );

  const finalizeDrag = useCallback(() => {
    const targetLeft = snapToThreshold(widthRef.current.left, "left");
    const targetRight = snapToThreshold(widthRef.current.right, "right");
    animateToWidths(targetLeft, targetRight, 200);
  }, [animateToWidths]);

  const startDrag = useCallback(
    (side: "left" | "right", e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setActiveHandle(side);
      dragRef.current = {
        startX: e.clientX,
        startLeftW: widthRef.current.left,
        startRightW: widthRef.current.right,
      };

      const onMove = (ev: globalThis.PointerEvent) => {
        updateWidthOnDrag(side, ev.clientX - dragRef.current.startX);
      };

      const teardown = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        cleanupRef.current = null;
      };

      const onUp = () => {
        teardown();
        setActiveHandle(null);
        finalizeDrag();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      cleanupRef.current = teardown;
    },
    [updateWidthOnDrag, finalizeDrag]
  );

  return { activeHandle, hitboxActive, widthRef, startDrag, animateToWidths };
};

const resolveActiveHandle = ({
  allowUserResize,
  allowLeftResize,
  allowRightResize,
  activeHandle,
}: {
  allowUserResize: boolean;
  allowLeftResize: boolean;
  allowRightResize: boolean;
  activeHandle: "left" | "right" | null;
}): "left" | "right" | undefined => {
  if (!allowUserResize) {
    return undefined;
  }
  if (activeHandle === "left" && allowLeftResize) {
    return "left";
  }
  if (activeHandle === "right" && allowRightResize) {
    return "right";
  }
  return undefined;
};

const resolveHoveredHandle = ({
  allowUserResize,
  allowLeftResize,
  allowRightResize,
  activeHandle,
  hoveredHandle,
}: {
  allowUserResize: boolean;
  allowLeftResize: boolean;
  allowRightResize: boolean;
  activeHandle: "left" | "right" | null;
  hoveredHandle: "left" | "right" | null;
}): "left" | "right" | undefined => {
  if (!allowUserResize || activeHandle) {
    return undefined;
  }
  if (hoveredHandle === "left" && allowLeftResize) {
    return "left";
  }
  if (hoveredHandle === "right" && allowRightResize) {
    return "right";
  }
  return undefined;
};

interface ResizeControlsProps {
  allowUserResize: boolean;
  allowLeftResize: boolean;
  allowRightResize: boolean;
  activeHandle: "left" | "right" | null;
  leftWidth: number;
  rightWidth: number;
  startDrag: (side: "left" | "right", e: PointerEvent<HTMLDivElement>) => void;
  setHoveredHandle: (side: "left" | "right" | null) => void;
}

const ResizeControls = ({
  allowUserResize,
  allowLeftResize,
  allowRightResize,
  activeHandle,
  leftWidth,
  rightWidth,
  startDrag,
  setHoveredHandle,
}: ResizeControlsProps) => {
  if (!allowUserResize) {
    return null;
  }

  const leftHandleEnabled = allowLeftResize && leftWidth > 0;
  const rightHandleEnabled = allowRightResize && rightWidth > 0;

  const handlePointerDown = (
    side: "left" | "right",
    enabled: boolean,
    e: PointerEvent<HTMLDivElement>
  ) => {
    if (!enabled) {
      return;
    }
    startDrag(side, e);
  };

  const handlePointerEnter = (side: "left" | "right", enabled: boolean) => {
    if (!enabled || activeHandle) {
      return;
    }
    setHoveredHandle(side);
  };

  return (
    <>
      <DragHandle
        enabled={leftHandleEnabled}
        isActive={activeHandle === "left"}
        onPointerDown={(e) => handlePointerDown("left", leftHandleEnabled, e)}
        onPointerEnter={() => handlePointerEnter("left", allowLeftResize)}
        onPointerLeave={() => !activeHandle && setHoveredHandle(null)}
        position={leftWidth}
        side="left"
      />
      <DragHandle
        enabled={rightHandleEnabled}
        isActive={activeHandle === "right"}
        onPointerDown={(e) => handlePointerDown("right", rightHandleEnabled, e)}
        onPointerEnter={() => handlePointerEnter("right", allowRightResize)}
        onPointerLeave={() => !activeHandle && setHoveredHandle(null)}
        position={rightWidth}
        side="right"
      />
    </>
  );
};

const ResizableGrid = ({
  left,
  center,
  right,
  initialLeft,
  initialRight,
  onLeftCollapsedChange,
  allowUserResize = true,
  allowLeftResize = true,
  allowRightResize = true,
  onWidthsChange,
  ref,
}: ResizableGridProps & { ref?: Ref<ResizableGridHandle> }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredHandle, setHoveredHandle] = useState<"left" | "right" | null>(
    null
  );
  const { activeHandle, hitboxActive, widthRef, startDrag, animateToWidths } =
    useDragResize(
      containerRef,
      initialLeft ?? CONSTRAINTS.left.initial,
      initialRight ?? CONSTRAINTS.right.initial,
      onWidthsChange
    );

  const activeHandleAttr = resolveActiveHandle({
    allowUserResize,
    allowLeftResize,
    allowRightResize,
    activeHandle,
  });
  const hoveredHandleAttr = resolveHoveredHandle({
    allowUserResize,
    allowLeftResize,
    allowRightResize,
    activeHandle,
    hoveredHandle,
  });

  useEffect(() => {
    onLeftCollapsedChange?.(hitboxActive.left);
  }, [hitboxActive.left, onLeftCollapsedChange]);

  useImperativeHandle(
    ref,
    () => ({
      setWidths: animateToWidths,
      getWidths() {
        return widthRef.current;
      },
    }),
    [animateToWidths, widthRef]
  );

  return (
    <div
      className="resizable-grid relative grid flex-1 overflow-hidden"
      data-active-handle={activeHandleAttr}
      data-hovered-handle={hoveredHandleAttr}
      data-left-open={widthRef.current.left > 0 ? "" : undefined}
      data-right-open={widthRef.current.right > 0 ? "" : undefined}
      ref={containerRef}
      style={
        {
          gridTemplateColumns: `${widthRef.current.left}px 1fr ${widthRef.current.right}px`,
          "--left-progress": normalizeProgress(
            widthRef.current.left,
            CONSTRAINTS.left.initial
          ),
          "--right-progress": normalizeProgress(
            widthRef.current.right,
            CONSTRAINTS.right.initial
          ),
          cursor: allowUserResize && activeHandle ? "grabbing" : undefined,
        } as CSSProperties
      }
    >
      <SidebarPanel side="left" width={widthRef.current.left}>
        {left}
      </SidebarPanel>

      <main className="min-h-0 min-w-0 overflow-hidden">{center}</main>

      <SidebarPanel side="right" width={widthRef.current.right}>
        {right}
      </SidebarPanel>

      <ResizeControls
        activeHandle={activeHandle}
        allowLeftResize={allowLeftResize}
        allowRightResize={allowRightResize}
        allowUserResize={allowUserResize}
        leftWidth={widthRef.current.left}
        rightWidth={widthRef.current.right}
        setHoveredHandle={setHoveredHandle}
        startDrag={startDrag}
      />
    </div>
  );
};

export default ResizableGrid;
