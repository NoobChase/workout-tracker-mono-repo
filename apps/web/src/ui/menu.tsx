import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui's DropdownMenu, restyled: a paper floater with a Strong Hairline
 * edge and the toast's drop, items as 44px ruled lines in ink. It grows from
 * its trigger (Radix's transform origin), not from its center, in 150ms, and
 * leaves faster. Keyboard and typeahead are Radix's.
 */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-xl border border-line-2 bg-background p-1 text-foreground outline-none",
          "shadow-[0_12px_32px_-12px_var(--shadow)]",
          "origin-(--radix-dropdown-menu-content-transform-origin)",
          "data-[state=open]:animate-[tanren-dialog-in_150ms_var(--ease-out)]",
          "data-[state=closed]:animate-[tanren-dialog-out_100ms_ease-out]",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 text-[15px] outline-none select-none",
        "data-highlighted:bg-ghost data-highlighted:text-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-45",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}
