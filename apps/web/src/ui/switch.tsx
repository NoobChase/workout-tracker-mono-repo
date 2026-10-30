import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * Radix's Switch, restyled: a 40×24 track on the Edge, ink when on, with
 * the controls' 8px corners (never a pill) and a thumb inset to match, as
 * the Segmented control's selected cell is. The thumb slides on the
 * ease-out curve; nothing moves under reduced motion.
 * Pair it with a visible <label>, in a row of at least 44px.
 */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-md border border-input bg-transparent p-0.5",
        "transition-[background-color,border-color] duration-150 ease-out",
        "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-[18px] rounded-[5px] bg-edge transition-transform duration-200 ease-out",
          "data-[state=checked]:translate-x-4 data-[state=checked]:bg-background",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
