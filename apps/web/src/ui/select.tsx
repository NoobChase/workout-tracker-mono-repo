import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * A native <select> in the Input's clothes: the platform's own picker on a
 * phone (fast, accessible, no portal), the Edge boundary and a Lucide
 * chevron everywhere.
 */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        data-slot="select"
        className={cn(
          "h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-background pr-9 pl-3 text-[15px] text-foreground",
          "transition-[border-color] duration-150 ease-out hover:border-muted-foreground focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
