import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  overlayClose,
  overlayDescription,
  overlaySurface,
  overlayTitle,
} from "./dialog.js";

/** The bottom sheet's own edge and shadow, on top of the shared surface. */
export const sheetSurface = cn(
  overlaySurface,
  "rounded-b-none border-b-0 px-5 pt-6 shadow-[0_-16px_40px_-16px_var(--shadow)]",
);

/*
 * shadcn/ui's Sheet as a bottom sheet: it rises from where the thumb already
 * is, on the iOS drawer curve, and drops away faster than it came.
 */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-scrim",
          "data-[state=open]:animate-[tanren-fade-in_300ms_var(--ease-drawer)]",
          "data-[state=closed]:animate-[tanren-fade-out_200ms_ease-out]",
        )}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col gap-5 overflow-y-auto",
          sheetSurface,
          "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "data-[state=open]:animate-[tanren-sheet-in_300ms_var(--ease-drawer)]",
          "data-[state=closed]:animate-[tanren-sheet-out_200ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className={overlayClose}>
          <X aria-hidden="true" strokeWidth={1.75} className="size-5" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 pr-10", className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(overlayTitle, className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn(overlayDescription, className)}
      {...props}
    />
  );
}
