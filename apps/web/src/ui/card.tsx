import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui's Card in the mockup's `.ex` idiom: a 12px card on --card with
 * one hairline, whose rows are ruled rather than boxed. Never nest one.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-line bg-card px-4 py-4 text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "text-[17px] leading-snug font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-2 border-t border-line pt-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A ruled line inside a card: what it is on the left, its state on the
 * right. Words stay in Albert Sans; compose numbers from SetFigures so a set
 * reads the same here as in the log.
 */
export function CardRow({
  label,
  value,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div
      data-slot="card-row"
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-3 text-sm text-foreground">
        {label}
      </span>
      <span className="text-[13px] text-muted-foreground">{value}</span>
    </div>
  );
}
