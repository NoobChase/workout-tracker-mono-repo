import { Check } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { AuthPath, LandingProps } from "../boot/shell.js";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { BlankFigure, SetFigures } from "@/ui/set-row";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Wordmark } from "@/ui/wordmark";
import { Headword } from "./headword.js";
import { OfflineDemo } from "./offline-demo.js";
import "./landing.css";

/*
 * The signed-out `/` (surface brief `.impeccable/surfaces/apps-web-src-landing.md`,
 * from mockup 7 "Stroke Order"). Its own chunk: no Clerk and no data layer,
 * so it paints before either has loaded (design D2). Calls to action hand
 * over to the app through `onAuth`; they are real links too, so a new tab
 * opens the same page.
 */

const WRAP = "mx-auto w-full max-w-[1280px] px-4 md:px-9";

/** The landing page's small-caps label: copper, 12px, tracked. */
const LABEL = "sc text-copper";

export function Landing({ onAuth }: LandingProps) {
  /** A plain click hands over in the page; a modified one opens a tab. */
  const to = (path: AuthPath) => ({
    href: path,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      onAuth(path);
    },
  });

  return (
    <div className="lp flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className={cn(WRAP, "flex h-16 items-center gap-4")}>
          <Wordmark />
          <nav
            aria-label="Primary"
            className="ml-auto flex items-center gap-1 text-sm min-[860px]:gap-3"
          >
            {[
              ["#usage", "Features"],
              ["#ai", "Your AI"],
              ["#pricing", "Pricing"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="hidden h-11 items-center rounded-sm px-2 text-muted-foreground no-underline transition-colors duration-150 hover:text-foreground min-[860px]:inline-flex"
              >
                {label}
              </a>
            ))}
            <a
              {...to("/sign-in")}
              className="inline-flex h-11 items-center rounded-sm px-2 font-medium text-foreground no-underline transition-colors duration-150 hover:text-muted-foreground"
            >
              Log in
            </a>
          </nav>
          <div className="flex items-center gap-2.5 min-[860px]:ml-3">
            <ThemeToggle />
            <Button
              asChild
              variant="primary"
              size="sm"
              className="hidden min-[480px]:inline-flex"
            >
              <a {...to("/sign-up")}>Get started</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section
          aria-label="Tanren, defined"
          className={cn(WRAP, "pt-5 md:pt-[clamp(24px,4.4vh,48px)]")}
        >
          <Headword />

          <div className="mt-[clamp(20px,3.4vh,32px)] grid gap-4 border-t border-line-2 pt-[clamp(20px,3.4vh,28px)] min-[980px]:grid-cols-[1fr_auto] min-[980px]:items-center min-[980px]:gap-10">
            <div>
              <p className="m-0 max-w-[54ch] text-[17px] text-muted-foreground">
                <b className="font-semibold text-foreground">
                  The training log for lifters who run a program.
                </b>{" "}
                Write the plan once. Log each set in a tap, signal or not. Watch
                the work add up.
              </p>
              <p className="mt-3 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-faint">
                <span className="sr-only">Example: </span>
                <Check
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5 shrink-0 text-copper"
                />
                <span>
                  Set{" "}
                  <span className="num">
                    <b className="font-medium text-copper">3</b> / 5
                  </span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-foreground">
                  Back Squat{" "}
                  <SetFigures
                    weight={225}
                    reps={5}
                    unit="lb"
                    className="text-[13px]"
                  />
                </span>
                <span aria-hidden="true">·</span>
                {/* A phone keeps the point, "no signal", and drops "logged". */}
                <span>
                  <span className="max-[519px]:hidden">logged, </span>no signal
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button
                asChild
                variant="primary"
                className="max-[519px]:flex-1 max-[519px]:px-4"
              >
                <a {...to("/sign-up")}>Start training</a>
              </Button>
              <Button asChild className="max-[519px]:flex-1 max-[519px]:px-4">
                <a href="#usage">How it works</a>
              </Button>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="mt-[clamp(20px,3.4vh,28px)] border-b border-line"
          />
        </section>

        <div className={WRAP}>
          <Note id="usage" label="In practice">
            <h2 className={H2}>
              Three things, <em className={EM}>done properly.</em>
            </h2>
            <p className={LEAD}>
              No feed, no streak guilt, no social anything. A program, a log,
              and the proof.
            </p>
            <ol className="mt-9 mb-0 grid list-none p-0">
              <Sense letter="a" title="Plan the work" example={<PlanCard />}>
                <p className="m-0">
                  Programs, cycles, workouts, sets. Build week one and Tanren
                  copies it forward. Change week six without touching week five.
                </p>
              </Sense>
              <Sense
                letter="b"
                title="Repeat the work"
                example={<OfflineDemo />}
              >
                <p className="m-0">
                  One tap per set with last session’s numbers inline. No signal?
                  Sets queue in order and sync later.
                </p>
                <p className="mt-2 mb-0">
                  Swap an exercise and the plan stays the plan.{" "}
                  <Soon className="align-[1px]" />
                </p>
              </Sense>
              <Sense
                letter="c"
                title="See it harden"
                soon
                example={<ProgressCard />}
              >
                <p className="m-0">
                  Cycle-over-cycle progression and plan-versus-actual adherence.
                  Warmups and drop sets never pad the numbers.
                </p>
              </Sense>
            </ol>
          </Note>

          <Note label="Who uses it">
            <h2 className={H2}>
              Lifters who already <em className={EM}>show up.</em>
            </h2>
            <ul className="mt-8 mb-0 grid list-none gap-[22px] p-0 min-[900px]:grid-cols-3 min-[900px]:gap-8">
              <Usage title="You run a program">
                5/3/1, a PPL split, your coach’s spreadsheet. Tanren holds the
                plan and puts the right numbers in front of you.
              </Usage>
              <Usage title="You train anywhere">
                Garage racks, concrete basements, hotel gyms. Logging never
                waits on a network.
              </Usage>
              <Usage title="You keep your record">
                Years of training shouldn’t be locked in someone else’s app.
                Export whenever you like. <Soon className="align-[1px]" />
              </Usage>
            </ul>
          </Note>

          <Note id="ai" label="See also: your AI" soon>
            <h2 className={H2}>
              Your assistant, reading{" "}
              <em className={EM}>your real training.</em>
            </h2>
            <p className={LEAD}>
              Connect the AI you already use. It reads your history and writes
              the next block straight into Tanren. We never pay for inference,
              so we never charge you for it. No AI? Programs import and export
              as plain JSON.
            </p>
            <AiExample />
          </Note>

          <Note id="pricing" label="Pricing" soon last>
            <h2 className={H2}>
              Try all of it. <em className={EM}>Then decide.</em>
            </h2>
            <div className="mt-8 grid overflow-hidden rounded-[14px] border border-line-2 min-[820px]:grid-cols-2">
              <div className="flex flex-col px-[22px] py-[26px]">
                <span className="sc text-muted-foreground">Trial</span>
                <p className="mt-2.5 mb-0 text-[44px] leading-none font-extrabold tracking-[-0.02em]">
                  Free{" "}
                  <small className="num text-xs font-normal tracking-normal text-faint">
                    · length TBD
                  </small>
                </p>
                <ul className="lp-dash mt-5 mb-6 grid list-none gap-[9px] p-0 text-muted-foreground">
                  <li>Everything that’s built, no limits</li>
                  <li>Logging, offline</li>
                  <li>Programs now; analytics and your own AI as they ship</li>
                </ul>
                <Button
                  asChild
                  variant="primary"
                  className="mt-auto self-start"
                >
                  <a {...to("/sign-up")}>Get started</a>
                </Button>
              </div>
              <div className="flex flex-col border-t border-line-2 bg-card px-[22px] py-[26px] min-[820px]:border-t-0 min-[820px]:border-l">
                <span className={LABEL}>Tanren</span>
                <p className="mt-2.5 mb-0 text-[44px] leading-none font-extrabold tracking-[-0.02em]">
                  <BlankFigure className="w-[2.4ch] border-b-[3px]" />
                  <span className="sr-only">Price not set yet</span>{" "}
                  <small
                    aria-hidden="true"
                    className="num text-xs font-normal tracking-normal text-faint"
                  >
                    · price TBD
                  </small>
                </p>
                <ul className="lp-dash mt-5 mb-0 grid list-none gap-[9px] p-0 text-muted-foreground">
                  <li>Everything in the trial, kept</li>
                  <li>Cancel any time</li>
                  <li>
                    Lapse and your log turns read-only, still yours to browse
                    and export
                  </li>
                </ul>
              </div>
            </div>
          </Note>
        </div>

        <section
          aria-label="Start"
          className="border-t border-line pt-[110px] pb-[100px]"
        >
          <div className={WRAP}>
            <div className="flex items-center gap-[clamp(12px,3vw,40px)]">
              <span
                lang="ja"
                className="font-mark text-[clamp(56px,12vw,120px)] leading-[0.95] font-extrabold"
              >
                鍛錬
              </span>
              <span className="grid gap-[clamp(6px,1.2vw,12px)]">
                <span className="text-[clamp(24px,5vw,52px)] leading-[0.9] font-extrabold tracking-[0.12em] uppercase">
                  Tanren
                </span>
                <span className="num text-[clamp(13px,1.6vw,18px)] leading-none text-muted-foreground">
                  /tahn·ren/
                </span>
              </span>
            </div>
            <p className="mt-[22px] mb-[26px] text-lg text-muted-foreground">
              Deliberate. Repeated. Recorded.
            </p>
            <Button asChild variant="primary">
              <a {...to("/sign-up")}>Start training</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line pt-[22px] pb-[calc(22px+env(safe-area-inset-bottom))] text-[13px] text-faint">
        <div
          className={cn(WRAP, "flex flex-wrap justify-between gap-x-6 gap-y-2")}
        >
          <span>Tanren · US only</span>
          <span>
            Stroke data:{" "}
            <a
              href="https://kanjivg.tagaini.net/"
              rel="noopener"
              className="underline"
            >
              KanjiVG
            </a>
            ,{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/3.0/"
              rel="license noopener"
              className="underline"
            >
              CC BY-SA 3.0
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

const H2 =
  "m-0 mb-3.5 text-[clamp(30px,5vw,52px)] leading-[1.06] font-bold tracking-[-0.025em] text-balance";
const EM = "text-copper not-italic";
const LEAD = "m-0 max-w-[58ch] text-[17px] text-muted-foreground";

/** "Coming soon": what the page describes but the app doesn't do yet. */
function Soon({ className }: { className?: string }) {
  return <Badge className={className}>Coming soon</Badge>;
}

/**
 * A usage note of the entry: its label in the margin (with "Coming soon"
 * under it when the whole section is), the content beside it.
 */
function Note({
  id,
  label,
  soon = false,
  last = false,
  children,
}: {
  id?: string;
  label: string;
  soon?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn(
        "grid gap-4 py-[72px] min-[980px]:grid-cols-[220px_1fr] min-[980px]:gap-10 min-[980px]:py-24",
        !last && "border-b border-line",
      )}
    >
      {/* The label lives in the desktop margin only: stacked above the
          heading on a phone it reads as an eyebrow (user's call, 2026-10-30).
          A "coming soon" badge still shows there. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 self-start min-[980px]:flex-col min-[980px]:items-start",
          !soon && "hidden min-[980px]:flex",
        )}
      >
        <span className={cn(LABEL, "hidden min-[980px]:inline")}>{label}</span>
        {soon ? <Soon /> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Sense({
  letter,
  title,
  soon = false,
  example,
  children,
}: {
  letter: string;
  title: string;
  soon?: boolean;
  example: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-3.5 border-t border-line py-6 min-[900px]:grid-cols-2 min-[900px]:items-start min-[900px]:gap-10">
      <div>
        <h3 className="m-0 mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[22px] leading-[1.2] font-bold">
          <span>
            <span aria-hidden="true" className="font-semibold text-copper">
              {letter}.{" "}
            </span>
            {title}
          </span>
          {soon ? <Soon /> : null}
        </h3>
        <div className="text-muted-foreground">{children}</div>
      </div>
      {example}
    </li>
  );
}

function Usage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-t-2 border-copper pt-4">
      <h3 className="m-0 mb-1.5 text-[19px] leading-snug font-bold">{title}</h3>
      <p className="m-0 text-muted-foreground">{children}</p>
    </li>
  );
}

/** A ruled card of example rows, the entry's illustration. */
function ExampleCard({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-line bg-card px-4 py-3.5 text-sm"
    >
      {children}
    </div>
  );
}

function ExampleRow({
  name,
  value,
  hot = false,
  depth = 0,
}: {
  name: string;
  value: ReactNode;
  hot?: boolean;
  depth?: number;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span
        className={cn(hot && "text-copper")}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {name}
      </span>
      <span className="text-right text-muted-foreground">{value}</span>
    </div>
  );
}

function PlanCard() {
  return (
    <ExampleCard>
      <ExampleRow
        name="Strength Block"
        value={
          <>
            <span className="num">8</span> cycles
          </>
        }
      />
      <ExampleRow
        name="Cycle 3 · Lower A"
        depth={1}
        value={
          <>
            <span className="num">5</span> exercises
          </>
        }
      />
      <ExampleRow
        name="Back Squat"
        depth={2}
        hot
        value={
          <span className="num">
            5 × 5 @ 225
            <span className="ml-1 text-[0.8em]">lb</span>
          </span>
        }
      />
    </ExampleCard>
  );
}

/** Demo data, and labelled so: there are no real lifters' numbers yet. */
const BARS = [44, 52, 58, 55, 67, 75, 84, 92];

function ProgressCard() {
  return (
    <ExampleCard>
      <ExampleRow name="Back Squat · top set" value="demo data" />
      <div className="flex h-[84px] items-end gap-[5px] pt-2">
        {BARS.map((height, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-t-[3px]",
              i === BARS.length - 1 ? "bg-copper" : "bg-line-2",
            )}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </ExampleCard>
  );
}

function AiExample() {
  return (
    <figure className="m-0 mt-8 grid max-w-[760px] gap-2.5">
      <figcaption className="text-[13px] text-faint">
        Example conversation
      </figcaption>
      <p className="m-0 max-w-[92%] justify-self-end rounded-xl bg-primary px-[15px] py-[13px] text-[15.5px] text-primary-foreground">
        Look at my last eight weeks of squat and adjust the next block.
      </p>
      <p className="num m-0 flex flex-wrap gap-x-2 text-xs text-faint">
        <span>read progression · Back Squat · 8 cycles</span>
        <span aria-hidden="true">/</span>
        <span>read adherence · Strength Block</span>
      </p>
      <p className="m-0 max-w-[92%] rounded-xl border border-line bg-card px-[15px] py-[13px] text-[15.5px]">
        Your top set rose every cycle except C4, where you missed two sessions.
        Next block starts at{" "}
        <b className="font-semibold text-copper">235 lb × 5</b>, adds 5 lb a
        cycle, deloads at C4. Saved as{" "}
        <b className="font-semibold text-copper">Strength Block II</b>.
      </p>
    </figure>
  );
}
