import { cn } from "@/lib/utils";

/**
 * The 鍛錬 TANREN lockup, the one place the kanji and Shippori Mincho appear in
 * the app. Read aloud as "Tanren": the kanji are hidden from assistive tech
 * and the romaji is real text, uppercased by CSS.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-foreground",
        className,
      )}
    >
      <span
        lang="ja"
        aria-hidden="true"
        className="font-mark text-[20px] leading-none font-extrabold"
      >
        鍛錬
      </span>
      <span className="text-[13px] leading-none font-bold tracking-[0.22em] uppercase">
        Tanren
      </span>
    </span>
  );
}
