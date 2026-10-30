import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TANREN } from "./kanjivg.js";

/** Remembered for the tab: the strokes draw once a visit, not on every return. */
const DRAWN_KEY = "tanren-drawn";

/*
 * The timeline: about 2.8s of drawing, each stroke's share weighted by its
 * length, each starting just before the last one lifts, with a breath
 * between the two characters.
 */
const DRAW_MS = 2_500;
const LIFT = 0.82;
const CHAR_GAP_MS = 200;
const MIN_STROKE_MS = 50;
const LEAD_MS = 220;
const SETTLE_MS = 260;
/** The brush font gets this long to arrive, so the settle lands on Shippori. */
const FONT_WAIT_MS = 600;
const BRUSH = "cubic-bezier(0.45, 0, 0.2, 1)";

const TOTAL = TANREN[0].strokes.length + TANREN[1].strokes.length;

type Intro = "ready" | "drawing" | "done";

function prefersStill(): boolean {
  return (
    typeof matchMedia !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof Element.prototype.animate !== "function"
  );
}

function drawnThisVisit(): boolean {
  try {
    return sessionStorage.getItem(DRAWN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDrawn() {
  try {
    sessionStorage.setItem(DRAWN_KEY, "1");
  } catch {
    // Storage off: it draws again next time, which is harmless.
  }
}

/** A figure space keeps the counter from jittering between 9 and 10. */
const pad = (n: number) => String(n).padStart(2, " ");

/**
 * The dictionary entry that opens the landing page: 鍛錬 written stroke by
 * stroke (KanjiVG's order, Shippori Mincho's ink), beside the romaji, the
 * gloss of each character and the definition. Each stroke draws wet in
 * copper, then sets in ink. Under reduced motion, or once drawn this visit,
 * the characters are simply finished. Tapping or hovering a character lights
 * its half of the gloss (and skips the drawing).
 */
export function Headword() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [still] = useState(prefersStill);
  const [intro, setIntro] = useState<Intro>(() =>
    still || drawnThisVisit() ? "done" : "ready",
  );
  const [lit, setLit] = useState<number | null>(null);
  const wetRefs = useRef<(SVGPathElement | null)[]>([]);
  const setRefs = useRef<(SVGPathElement | null)[]>([]);
  const countRef = useRef<HTMLSpanElement>(null);
  const run = useRef<{ stop: () => void } | null>(null);

  function finish() {
    run.current?.stop();
    run.current = null;
    for (const path of setRefs.current) path?.classList.add("on");
    setIntro("done");
    rememberDrawn();
  }

  function play() {
    run.current?.stop();
    const wet = wetRefs.current;
    const set = setRefs.current;
    for (const path of set) path?.classList.remove("on");
    for (const path of wet) path?.classList.remove("cool");

    // Lay out the timeline from each stroke's real length.
    const lengths = wet.map((path) => path?.getTotalLength?.() ?? 1);
    const sum = lengths.reduce((a, b) => a + b, 0);
    const firstOfSecond = TANREN[0].strokes.length;
    let t = LEAD_MS;
    const timing = lengths.map((length, i) => {
      if (i === firstOfSecond) t += CHAR_GAP_MS;
      const at = t;
      const duration = Math.max(MIN_STROKE_MS, (DRAW_MS * length) / sum);
      t += duration * LIFT;
      return { at, duration };
    });
    const last = timing[timing.length - 1]!;
    const end = last.at + last.duration + SETTLE_MS;

    const animations = wet.map((path, i) => {
      const animation = path?.animate(
        [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        {
          duration: timing[i]!.duration,
          delay: timing[i]!.at,
          fill: "forwards",
          easing: BRUSH,
        },
      );
      animation?.finished.then(
        () => {
          set[i]?.classList.add("on");
          path?.classList.add("cool");
        },
        () => {
          // Cancelled by Skip or a replay.
        },
      );
      return animation;
    });

    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - started;
      const drawn = timing.filter(({ at }) => at <= elapsed).length;
      if (countRef.current) countRef.current.textContent = pad(drawn);
      if (elapsed < end) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);

    run.current = {
      stop() {
        cancelAnimationFrame(frame);
        for (const animation of animations) animation?.cancel();
      },
    };
    setIntro("drawing");
  }

  // First visit: wait briefly for the brush font, then draw.
  useEffect(() => {
    if (intro !== "ready") return;
    let cancelled = false;
    void Promise.race([
      document.fonts?.ready,
      new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]).then(() => {
      if (!cancelled) play();
    });
    return () => {
      cancelled = true;
    };
    // Runs once, on arrival; `play` reads refs only.
  }, []);

  useEffect(() => () => run.current?.stop(), []);

  const drawing = intro === "drawing";

  return (
    <div
      className="lp-headword grid gap-3.5 min-[980px]:grid-cols-[auto_1fr] min-[980px]:items-start min-[980px]:gap-14"
      data-intro={intro}
    >
      <figure className="lp-diagram m-0">
        <div className="flex border border-line-2" lang="ja">
          {TANREN.map((c, ci) => (
            <button
              key={c.char}
              type="button"
              aria-label={c.label}
              aria-describedby={`${id}-gloss${ci}`}
              data-lit={lit === ci || undefined}
              onPointerEnter={() => setLit(ci)}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setLit(null);
              }}
              onFocus={() => setLit(ci)}
              onBlur={() => setLit(null)}
              onClick={() => {
                if (drawing) finish();
                setLit(ci);
              }}
              className="lp-cell"
            >
              <svg viewBox="0 0 109 109" aria-hidden="true">
                <path className="lp-guide" d="M54.5 0V109M0 54.5H109" />
                <defs>
                  <mask
                    id={`${id}-set${ci}`}
                    maskUnits="userSpaceOnUse"
                    x="-10"
                    y="-10"
                    width="129"
                    height="129"
                  >
                    <g className="lp-set" transform={c.transform}>
                      {c.strokes.map((d, si) => (
                        <path
                          key={si}
                          d={d}
                          ref={(el) => {
                            setRefs.current[strokeIndex(ci, si)] = el;
                          }}
                        />
                      ))}
                    </g>
                    <rect
                      className="lp-all"
                      x="-10"
                      y="-10"
                      width="129"
                      height="129"
                    />
                  </mask>
                  <mask
                    id={`${id}-wet${ci}`}
                    maskUnits="userSpaceOnUse"
                    x="-10"
                    y="-10"
                    width="129"
                    height="129"
                  >
                    <g className="lp-wet" transform={c.transform}>
                      {c.strokes.map((d, si) => (
                        <path
                          key={si}
                          d={d}
                          pathLength={1}
                          strokeDasharray="1 2"
                          ref={(el) => {
                            wetRefs.current[strokeIndex(ci, si)] = el;
                          }}
                        />
                      ))}
                    </g>
                  </mask>
                </defs>
                <Glyph char={c.char} className="lp-ghost" />
                <Glyph char={c.char} mask={`url(#${id}-set${ci})`} />
                <Glyph
                  char={c.char}
                  className="lp-hot"
                  mask={`url(#${id}-wet${ci})`}
                />
              </svg>
            </button>
          ))}
        </div>
        <figcaption className="num flex h-10 items-center justify-between gap-3 text-[13px] whitespace-nowrap text-faint">
          <span aria-hidden="true">
            {drawing ? (
              <>
                stroke{" "}
                <b ref={countRef} className="font-medium text-copper">
                  {pad(0)}
                </b>{" "}
                <span className="text-muted-foreground">/ {TOTAL}</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">{TOTAL} strokes</span>,
                <span className="max-[519px]:hidden"> each one</span> in order
              </>
            )}
          </span>
          <span className="sr-only">
            鍛錬 is written in {TOTAL} strokes: {TANREN[0].strokes.length} for
            鍛, {TANREN[1].strokes.length} for 錬.
          </span>
          {still ? null : (
            <button
              type="button"
              onClick={() => (drawing ? finish() : play())}
              className="-mr-2.5 inline-flex h-8 items-center gap-[7px] rounded-sm px-2.5 font-sans text-[13px] font-medium text-muted-foreground transition-[color,transform] duration-[160ms] ease-out hover:text-foreground active:scale-[0.96]"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-3.5"
              >
                <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77" />
                <path d="M2.5 2.25v2.5H5" />
              </svg>
              {drawing ? (
                "Skip"
              ) : (
                <span>
                  Replay<span className="max-[519px]:hidden"> strokes</span>
                </span>
              )}
            </button>
          )}
        </figcaption>
      </figure>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <span className="text-[clamp(34px,8.8vw,104px)] leading-[0.9] font-extrabold tracking-[0.12em] uppercase">
            Tanren
          </span>
          <span className="num text-[clamp(13px,1.6vw,18px)] leading-none text-muted-foreground">
            /tahn·ren/
            <span className="max-[519px]:hidden">{"  ·  "}Japanese</span>
          </span>
        </div>
        <p className="mt-[clamp(4px,1.4vw,18px)] mb-0 flex flex-wrap gap-x-2.5 gap-y-1 text-sm text-faint max-[519px]:grid max-[519px]:gap-0.5">
          {TANREN.map((c, ci) => (
            <span key={c.char} className="contents">
              {ci > 0 ? (
                <span aria-hidden="true" className="max-[519px]:hidden">
                  ·
                </span>
              ) : null}
              <span
                id={`${id}-gloss${ci}`}
                className={cn(
                  "transition-colors duration-200",
                  lit === ci && "text-foreground",
                )}
              >
                <b lang="ja" className="mr-1.5 font-mark text-copper">
                  {c.char}
                </b>
                {c.reading} — {c.gloss}
              </span>
            </span>
          ))}
        </p>
        <p className="mt-[clamp(14px,2.4vh,24px)] mb-0 max-w-[28ch] border-t border-line-2 pt-[clamp(14px,2.4vh,22px)] text-[clamp(22px,2.3vw,32px)] leading-[1.2] font-medium tracking-[-0.02em] text-pretty">
          <i className="mr-[0.35em] text-[0.7em] font-medium tracking-normal text-copper">
            noun
          </i>
          The hardening of{" "}
          <em className="text-copper not-italic">body and mind</em> through
          deliberate, repeated training.
        </p>
      </div>
    </div>
  );
}

function strokeIndex(char: number, stroke: number): number {
  return char === 0 ? stroke : TANREN[0].strokes.length + stroke;
}

function Glyph({
  char,
  className,
  mask,
}: {
  char: string;
  className?: string;
  mask?: string;
}) {
  return (
    <text
      className={cn("lp-glyph", className)}
      x="54.5"
      y="54.5"
      textAnchor="middle"
      dominantBaseline="central"
      mask={mask}
    >
      {char}
    </text>
  );
}
