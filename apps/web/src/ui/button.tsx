import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent } from "react";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui's Button, restyled. One shape everywhere: 8px corners, a hairline
 * edge, and a press that scales to .97. Copper fills only the primary action;
 * every other variant is ink on the page. Hover is a quiet color shift, and
 * only on devices that actually hover.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap select-none",
    "transition-[transform,background-color,border-color,color] duration-[160ms] ease-out",
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-busy:pointer-events-none",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_86%,black)]",
        secondary:
          "border-line-2 bg-transparent text-foreground hover:border-muted-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-ghost hover:text-foreground",
        destructive:
          "border-line-2 bg-transparent text-danger hover:border-danger",
      },
      size: {
        sm: "h-9 px-3.5 text-sm",
        md: "h-12 px-5.5 text-[15px]",
        /** The logging size: a chalked thumb's target, mid-set. */
        log: "h-14 px-6 text-base [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (a link, say) with the button's styling. */
    asChild?: boolean;
    /** Busy: keeps its width and label, announces itself, ignores presses. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  type,
  onClick,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // A button inside a form defaults to submit; make that a choice.
      type={asChild ? undefined : (type ?? "button")}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      // Busy ignores every activation, keyboard included (the CSS only stops
      // the pointer). Not `disabled`: that would drop focus from the button
      // the lifter just pressed, and its ring with it.
      onClick={
        loading
          ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()
          : onClick
      }
      {...props}
    >
      {loading && !asChild ? (
        <>
          <span className="invisible contents">{children}</span>
          <Spinner className="absolute" />
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cn(
        "animate-[tanren-spin_700ms_linear_infinite] motion-reduce:animate-none",
        className,
      )}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.8"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
