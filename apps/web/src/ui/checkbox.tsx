import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * Radix's Checkbox, restyled: a 22px box on the Edge (3:1, findable), filled
 * with ink when checked. Ink, not copper: copper is the primary action and
 * the live set only. Put it in a <label> row of at least 44px.
 */
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "grid size-[22px] shrink-0 place-items-center rounded-sm border border-input bg-transparent text-background",
        "transition-[background-color,border-color] duration-150 ease-out",
        "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check aria-hidden="true" strokeWidth={2.5} className="size-4" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
