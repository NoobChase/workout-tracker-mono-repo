import { cn } from "@/lib/utils";

/*
 * The builder's three small marks (brief `apps-web-src-builder`): ● a
 * logged cycle, ◆ a cycle that differs from cycle 1, ∘ a placeholder slot.
 * Drawn, in ink, sized to the text; each says itself in words for
 * assistive tech (`label`), or is hidden when its row already does.
 */

export function LoggedMark({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 8 8"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-[7px] shrink-0 fill-current", className)}
    >
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}

export function DifferentMark({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-[9px] shrink-0 fill-current", className)}
    >
      <path d="M5 0 10 5 5 10 0 5Z" />
    </svg>
  );
}

export function PlaceholderMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn(
        "size-[9px] shrink-0 fill-none stroke-current stroke-[1.5]",
        className,
      )}
    >
      <circle cx="5" cy="5" r="4" />
    </svg>
  );
}

/**
 * Mixed text with its figures in mono and its words in Albert Sans ("3 ×
 * 8–10 @ 225 lb · RIR 2"): the Numbers Are Mono rule, for a summary line.
 */
export function Figures({ text }: { text: string }) {
  const parts = text.split(/(\d+(?:\.\d+)?(?:–\d+)?|×)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
