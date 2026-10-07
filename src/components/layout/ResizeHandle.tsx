import clsx from "clsx";
import type { HTMLAttributes } from "react";

type Props = {
  axis: "x" | "y";
  /** Where the handle sits relative to the panel */
  edge: "left" | "right" | "top" | "bottom";
} & HTMLAttributes<HTMLDivElement>;

/**
 * Thin drag strip between panels. Extends hit area without stealing layout space.
 */
export function ResizeHandle({ axis, edge, className, ...rest }: Props) {
  const isX = axis === "x";
  return (
    <div
      role="separator"
      aria-orientation={isX ? "vertical" : "horizontal"}
      title="Drag to resize"
      className={clsx(
        "absolute z-20 touch-none transition-colors",
        "hover:bg-cyan-500/40 active:bg-cyan-500/60",
        isX
          ? "top-0 h-full w-1.5 cursor-col-resize"
          : "left-0 h-1.5 w-full cursor-row-resize",
        edge === "right" && "right-0 translate-x-1/2",
        edge === "left" && "left-0 -translate-x-1/2",
        edge === "top" && "top-0 -translate-y-1/2",
        edge === "bottom" && "bottom-0 translate-y-1/2",
        className,
      )}
      {...rest}
    />
  );
}
