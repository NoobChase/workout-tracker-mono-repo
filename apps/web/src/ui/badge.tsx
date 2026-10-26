import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * Set kinds and units. A dashed edge means "does not count": warmups and drop
 * sets never reach a total, chart or PR, and the badge says so at a glance.
 * Units are plain mono. No color here: copper belongs to the live set.
 */
export const badgeVariants = cva(
  "inline-flex h-6 shrink-0 items-center rounded-sm border px-2 whitespace-nowrap",
  {
    variants: {
      variant: {
        warmup:
          "sc border-dashed border-edge text-[11px] text-muted-foreground",
        drop: "sc border-dashed border-edge text-[11px] text-muted-foreground",
        unit: "num border-line-2 text-xs text-muted-foreground",
        neutral: "border-line-2 text-xs font-medium text-muted-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

const KIND_TEXT = { warmup: "Warmup", drop: "Drop" } as const;

export function Badge({
  className,
  variant,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const kindText =
    variant === "warmup" || variant === "drop" ? KIND_TEXT[variant] : null;
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {children ?? kindText}
    </span>
  );
}
