import { Minus, Plus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type NumberStepperProps = {
  /** Visible label, also the start of each button's accessible name. */
  label: string;
  /**
   * `null` is empty: nothing entered yet (a weight never logged before). It
   * shows a dash; + starts from the minimum, − waits for a number.
   */
  value: number | null;
  onValueChange: (value: number) => void;
  /** What one press of − or + (or one ↑/↓) moves. */
  step: number;
  /** PageUp/PageDown move this much; defaults to five steps. */
  bigStep?: number;
  min?: number;
  max?: number;
  /** Shown after the number and read with it, e.g. "lb", "kg", "reps". */
  unit?: string;
  /** Allow a decimal point (weights); reps are whole numbers. */
  decimal?: boolean;
  disabled?: boolean;
  /** Marked invalid from outside (a required value is missing, say). */
  invalid?: boolean;
  /** Id of a message that explains the field, such as its error. */
  describedBy?: string;
  id?: string;
  className?: string;
};

/** Rounds away binary-float drift (2.5 + 0.1 …) without losing real decimals. */
function tidy(n: number) {
  return Math.round(n * 1000) / 1000;
}

function format(n: number | null) {
  return n === null ? "" : String(tidy(n));
}

/**
 * A number the lifter changes mid-set: 56px − and + targets, the number
 * itself typed directly, ↑/↓ for one step and PageUp/PageDown for five. Mono
 * tabular figures, so 95 → 100 never jitters.
 *
 * Typing reports each in-range value as it is typed, so a display can follow
 * along. An out-of-range entry is reported to nobody: the field marks itself
 * invalid and announces what it shows, until leaving it (or Enter) clamps.
 * An empty entry quietly reverts to the last value.
 */
export function NumberStepper({
  label,
  value,
  onValueChange,
  step,
  bigStep = step * 5,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  unit,
  decimal = false,
  disabled = false,
  invalid: invalidFromOutside = false,
  describedBy,
  id,
  className,
}: NumberStepperProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const labelId = `${autoId}-label`;
  const inputRef = useRef<HTMLInputElement>(null);
  // While the field has focus it shows what is being typed, not `value`.
  const [draft, setDraft] = useState<string | null>(null);
  // The last value this stepper reported, to tell its own updates from a
  // change made elsewhere (a new set loading its prescription, say).
  const reported = useRef(value);

  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    // Changed from outside while focused: show the new value, not the draft.
    setDraft((current) => (current === null ? null : format(value)));
  }, [value]);

  const report = (n: number) => {
    reported.current = n;
    onValueChange(n);
  };

  const clamp = (n: number) => tidy(Math.min(max, Math.max(min, n)));
  const parse = (text: string) => {
    if (text.trim() === "" || text === ".") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };

  const shown = draft ?? format(value);
  const lower = label.toLowerCase();
  const unitText = unit ? ` ${unit}` : "";
  // "Increase weight by 2.5 kg", but "Decrease reps by 1", not "by 1 reps".
  const stepText =
    unit && !lower.includes(unit.toLowerCase())
      ? `${format(step)} ${unit}`
      : format(step);
  const typed = draft === null ? null : parse(draft);
  const inRange = (n: number) => n >= min && n <= max;
  const invalid =
    (typed !== null && !inRange(typed)) ||
    (invalidFromOutside && typed === null);
  // What assistive tech hears always matches what the field shows.
  const announced = typed ?? value;

  const nudge = (delta: number) => {
    const from = draft !== null ? (parse(draft) ?? value) : value;
    // Empty: + lands on the first step above the minimum; − has nowhere to go.
    if (from === null && delta < 0) return;
    const next = from === null ? clamp(min + delta) : clamp(from + delta);
    if (draft !== null) setDraft(format(next));
    if (next !== value) report(next);
  };

  const commit = () => {
    if (draft === null) return;
    const n = parse(draft);
    setDraft(null);
    if (n === null) return;
    const next = clamp(decimal ? n : Math.round(n));
    if (next !== value) report(next);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    const allowed = decimal ? /^\d*\.?\d{0,2}$/ : /^\d*$/;
    if (!allowed.test(text)) return;
    setDraft(text);
    const n = parse(text);
    if (n !== null && inRange(n) && tidy(n) !== value) report(tidy(n));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: step,
      ArrowDown: -step,
      PageUp: bigStep,
      PageDown: -bigStep,
    };
    const delta = moves[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      nudge(delta);
    } else if (event.key === "Enter") {
      commit();
    }
  };

  const atMin = value === null || value <= min;
  const atMax = value !== null && value >= max;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn("flex flex-col gap-2", className)}
    >
      <label
        id={labelId}
        htmlFor={inputId}
        className="text-sm leading-none font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div
        data-slot="stepper-field"
        className={cn(
          "flex h-14 items-stretch rounded-md border border-input",
          "transition-[border-color] duration-150 ease-out has-[input:focus]:border-ring",
          // The field draws the focus ring for its input, which has none.
          "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-ring",
          invalid && "border-danger has-[input:focus]:border-danger",
          disabled && "opacity-45",
        )}
      >
        <StepButton
          label={`Decrease ${lower} by ${stepText}`}
          disabled={disabled || atMin}
          onPress={() => nudge(-step)}
        >
          <Minus strokeWidth={1.75} />
        </StepButton>
        <div
          // A press anywhere on the number lands in the field (a click, not a
          // pointerdown, so iOS still raises the keyboard).
          onClick={() => inputRef.current?.focus()}
          className="flex min-w-0 flex-1 cursor-text items-center justify-center border-x border-line"
        >
          <span className="flex items-baseline gap-1.5">
            <input
              ref={inputRef}
              id={inputId}
              role="spinbutton"
              inputMode={decimal ? "decimal" : "numeric"}
              autoComplete="off"
              enterKeyHint="done"
              aria-valuenow={announced ?? undefined}
              aria-valuemin={min}
              aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
              aria-valuetext={
                announced === null ? "Empty" : `${format(announced)}${unitText}`
              }
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              value={shown}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onFocus={(event) => {
                setDraft(format(value));
                event.target.select();
              }}
              onBlur={commit}
              style={{ width: `${Math.max(shown.length, 1) + 0.25}ch` }}
              className="num min-w-[1.25ch] bg-transparent p-0 text-center text-[26px] leading-none font-medium text-foreground outline-none"
            />
            {unit ? (
              <span
                aria-hidden="true"
                className="num text-sm text-muted-foreground"
              >
                {unit}
              </span>
            ) : null}
          </span>
        </div>
        <StepButton
          label={`Increase ${lower} by ${stepText}`}
          disabled={disabled || atMax}
          onPress={() => nudge(step)}
        >
          <Plus strokeWidth={1.75} />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      // Keep focus (and the soft keyboard) in the field while stepping.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        "grid w-14 shrink-0 place-items-center text-foreground",
        "transition-[background-color,color] duration-150 ease-out",
        "hover:bg-ghost active:bg-ghost disabled:text-faint disabled:hover:bg-transparent",
        "focus-visible:-outline-offset-2",
        // The buttons share the field's hairlines, so the icon takes the
        // press instead of the button (the one exception to scale .97).
        "[&_svg]:size-5 [&_svg]:transition-transform [&_svg]:duration-[160ms] [&_svg]:ease-out active:[&_svg]:scale-[0.85]",
      )}
    >
      {children}
    </button>
  );
}
