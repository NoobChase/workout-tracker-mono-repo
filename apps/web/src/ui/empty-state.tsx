import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * What a log looks like before anything is in it: a few blank ruled lines,
 * numbered in order, so the first screen already teaches how sets will land.
 * The lines are drawing, not rows; no set exists until one is logged.
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col gap-5", className)}
    >
      <div aria-hidden="true" className="border-t border-line">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="flex h-11 items-center gap-3 border-b border-dashed border-line"
          >
            <span className="num w-10 text-[15px] text-faint">{n}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[17px] leading-snug font-semibold text-foreground">
          {title}
        </h3>
        {children ? (
          <p className="max-w-[48ch] text-[15px] text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
