import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui's Dialog, restyled. Centered, so it scales from its own center;
 * enters in 200ms and leaves faster. For a decision that needs protected
 * focus only: anything inline-able stays inline.
 */
/** Surface, title, body and close-button looks, shared with SheetContent and
 * the kit's static, open specimens so stills and live overlays cannot drift. */
export const overlaySurface =
  "rounded-xl border border-line-2 bg-background text-foreground outline-none";
export const dialogShadow = "shadow-[0_24px_48px_-12px_var(--shadow)]";
export const overlayTitle =
  "text-xl leading-tight font-bold tracking-[-0.01em] text-balance";
export const overlayDescription = "text-[15px] text-muted-foreground";
export const overlayClose =
  "absolute top-3 right-3 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-ghost hover:text-foreground";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim",
        "data-[state=open]:animate-[tanren-fade-in_200ms_var(--ease-out)]",
        "data-[state=closed]:animate-[tanren-fade-out_150ms_ease-out]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5",
          overlaySurface,
          dialogShadow,
          "p-6",
          "data-[state=open]:animate-[tanren-dialog-in_200ms_var(--ease-out)]",
          "data-[state=closed]:animate-[tanren-dialog-out_150ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className={overlayClose}>
          <X aria-hidden="true" strokeWidth={1.75} className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 pr-10", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(overlayTitle, className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(overlayDescription, className)}
      {...props}
    />
  );
}
