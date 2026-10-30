import { cn } from "@/lib/utils";
import { useTheme } from "./theme.js";

/**
 * The mockup's `.tt` control: names the theme showing, flips it on press, and
 * remembers the choice. Until pressed, the device decides.
 */
export function ThemeToggle({
  className,
  compactOnPhone = false,
}: {
  className?: string;
  /** Below `sm`, show the glyph alone (the label stays its accessible name). */
  compactOnPhone?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const showing = theme === "dark" ? "Dark" : "Light";
  const other = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${showing} theme, switch to ${other}`}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-md border border-line-2 px-3.5 text-[13px] font-medium text-muted-foreground",
        "transition-[color,border-color,transform] duration-[160ms] ease-out active:scale-[0.97]",
        "hover:border-muted-foreground hover:text-foreground",
        compactOnPhone && "max-sm:w-11 max-sm:justify-center max-sm:px-0",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
        className="size-[15px]"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </svg>
      <span className={compactOnPhone ? "max-sm:hidden" : undefined}>
        {showing}
      </span>
    </button>
  );
}
