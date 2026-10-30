import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";

/**
 * A compact number for planning screens (a rep target, a weight, an RIR):
 * 44px tall, mono, typed directly, empty meaning "not set". ↑/↓ move one
 * step. Leaving the field rounds to the step and clamps to the range, so
 * what is stored is always valid; an out-of-range entry is marked invalid
 * while it is being typed. Exposed as a spinbutton (value, range, unit).
 * Not the logging control: that is NumberStepper.
 */
export function NumberField({
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  decimals = 0,
  unit,
  invalid = false,
  className,
  placeholder,
  ...aria
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max: number;
  step?: number;
  /** Decimal places allowed while typing (0: whole numbers). */
  decimals?: number;
  /** Shown after the number, muted ("lb"). */
  unit?: string;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const reported = useRef(value);
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setDraft(null);
  }, [value]);

  const parse = (text: string) => {
    if (text.trim() === "" || text === ".") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };
  const tidy = (n: number) => {
    const snapped = Math.round(n / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Math.round(clamped * 100) / 100;
  };
  const report = (n: number | null) => {
    reported.current = n;
    onValueChange(n);
  };

  const shown = draft ?? (value === null ? "" : String(value));
  const typed = draft === null ? value : parse(draft);
  const outOfRange = typed !== null && (typed < min || typed > max);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    const allowed =
      decimals > 0 ? new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`) : /^\d*$/;
    if (!allowed.test(text)) return;
    setDraft(text);
    const n = parse(text);
    if (n === null) report(null);
    else if (n >= min && n <= max) report(n);
  };

  const commit = () => {
    if (draft === null) return;
    const n = parse(draft);
    setDraft(null);
    const next = n === null ? null : tidy(n);
    if (next !== value) report(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const from = parse(shown);
    const next = tidy(
      from === null ? min : from + (event.key === "ArrowUp" ? step : -step),
    );
    setDraft(null);
    report(next);
  };

  return (
    <span
      data-slot="number-field"
      className={cn(
        "inline-flex h-11 min-w-0 items-center gap-1 rounded-md border border-input px-2.5",
        "transition-[border-color] duration-150 ease-out hover:border-muted-foreground has-[input:focus]:border-ring",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-ring",
        (invalid || outOfRange) &&
          "border-danger has-[input:focus]:border-danger",
        className,
      )}
    >
      <input
        {...aria}
        // A typed number with a range and ↑/↓ steps: a spinbutton, so a
        // screen reader announces the value, its bounds and its unit. Not
        // `type="number"`, which mangles a half-typed "2." and the empty
        // "not set" state.
        role="spinbutton"
        aria-valuenow={typed ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={
          typed === null ? "Not set" : unit ? `${typed} ${unit}` : undefined
        }
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        enterKeyHint="done"
        value={shown}
        placeholder={placeholder}
        aria-invalid={invalid || outOfRange || undefined}
        onChange={onChange}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.target.select()}
        className="num w-full min-w-0 bg-transparent text-right text-[15px] text-foreground outline-none placeholder:text-faint"
      />
      {unit ? (
        <span
          aria-hidden="true"
          className="num text-[13px] text-muted-foreground"
        >
          {unit}
        </span>
      ) : null}
    </span>
  );
}
