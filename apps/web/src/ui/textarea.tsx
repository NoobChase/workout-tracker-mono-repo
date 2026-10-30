import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** The Input's multi-line sibling: the same Edge, focus and invalid states. */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full min-w-0 rounded-md border border-input bg-transparent px-3.5 py-2.5 text-base text-foreground",
        "transition-[border-color] duration-150 ease-out",
        "hover:border-muted-foreground focus-visible:border-ring",
        "aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
