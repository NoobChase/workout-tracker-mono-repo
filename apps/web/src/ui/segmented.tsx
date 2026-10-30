import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

/*
 * A small one-of-n switch (RIR or RPE; a number of cycles or open-ended;
 * required or optional): Radix's single ToggleGroup, so arrow keys move
 * between the options. The chosen option sits on the Ghost Wash in ink
 * (never copper), the others muted. Planning screens only: 36px tall.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string; ariaLabel?: string }[];
  /** The group's accessible name. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix sends "" when the chosen option is pressed again: keep it.
      onValueChange={(v) => (v ? onValueChange(v as T) : undefined)}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 shrink-0 items-stretch rounded-md border border-line-2 p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            "rounded-[5px] px-2.5 text-[13px] font-medium text-muted-foreground",
            "transition-[background-color,color] duration-150 ease-out hover:text-foreground",
            "data-[state=on]:bg-ghost data-[state=on]:font-semibold data-[state=on]:text-foreground",
            "focus-visible:outline-offset-1 disabled:opacity-45",
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
