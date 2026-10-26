import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui's Input, restyled. The edge is --edge, not a hairline: a field's
 * boundary has to clear 3:1 to be findable. Invalid fields say so in their
 * border and through aria-invalid; the message itself is the caller's.
 */
export function Input({
  className,
  type = "text",
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-12 w-full min-w-0 rounded-md border border-input bg-transparent px-3.5 text-base text-foreground",
        "transition-[border-color] duration-150 ease-out",
        "hover:border-muted-foreground focus-visible:border-ring",
        "aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-45",
        "file:border-0 file:bg-transparent file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
