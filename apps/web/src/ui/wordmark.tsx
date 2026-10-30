import { cn } from "@/lib/utils";

/**
 * The TANREN wordmark: the name alone, 13px at 700 with 0.22em tracking.
 * The kanji are not part of it; 鍛錬 and Shippori Mincho appear only in the
 * landing page's hero and closing lockup. Read aloud as "Tanren": the text is
 * real, uppercased by CSS.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[13px] leading-none font-bold tracking-[0.22em] text-foreground uppercase",
        className,
      )}
    >
      Tanren
    </span>
  );
}
