import type { ProgramSummary, TemplateSummary } from "@workout-tracker/shared";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  useOnline,
  usePrograms,
  useStartProgram,
  useTemplates,
} from "../data/hooks.js";
import { OfflineLine } from "./notice.js";
import { copyDescription, CopyForm } from "./program-dialogs.js";
import {
  lengthLabel,
  programErrorText,
  STATUS_LABEL,
} from "./program-format.js";
import { ServerRead } from "./server-read.js";
import { Button } from "@/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";
import { toast } from "@/ui/toaster";

export type NewProgramStep = "choose" | "template" | "copy";

/*
 * "+ New program" (brief `apps-web-src-home`): one sheet with three ways in.
 * Templates live here, not on home. A template start and a copy are
 * plan-side writes, online only; "Create from scratch" writes nothing and
 * opens the builder (spec `program-templates`).
 */
export function NewProgramSheet({
  open,
  step,
  onOpenChange,
  onStepChange,
}: {
  open: boolean;
  step: NewProgramStep;
  onOpenChange: (open: boolean) => void;
  onStepChange: (step: NewProgramStep) => void;
}) {
  const navigate = useNavigate();
  const [copying, setCopying] = useState<ProgramSummary | null>(null);
  const close = () => {
    onOpenChange(false);
    setCopying(null);
  };

  let title = "New program";
  let description: ReactNode =
    "Start from a template, write your own, or copy one you’ve run.";
  let body: ReactNode;
  if (step === "template") {
    title = "Start from a template";
    description =
      "It becomes your program: open-ended, one cycle at a time. No weights are set for you; the first time through, you enter your own.";
    body = <TemplateList onStarted={close} />;
  } else if (step === "copy") {
    title = copying ? `Copy ${copying.name}` : "Copy one of mine";
    description = copying
      ? copyDescription(copying)
      : "The copy is a new draft. Nothing is shared with the original.";
    body = (
      <CopyChooser
        copying={copying}
        onPick={setCopying}
        onBack={() => setCopying(null)}
        onDone={close}
      />
    );
  } else {
    body = (
      <div className="flex flex-col border-t border-line">
        <Choice
          title="Start from a template"
          detail="Ready-made splits to train today."
          onPress={() => onStepChange("template")}
        />
        <Choice
          title="Create from scratch"
          detail="Your own workouts, exercises, sets and rep targets."
          onPress={() => {
            close();
            void navigate("/programs/new");
          }}
        />
        <Choice
          title="Copy one of mine"
          detail="A new draft from a program you already have."
          onPress={() => onStepChange("copy")}
        />
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <SheetContent>
        <SheetHeader>
          {step !== "choose" ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 self-start px-3"
              onClick={() => {
                setCopying(null);
                onStepChange("choose");
              }}
            >
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              All ways to start
            </Button>
          ) : null}
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {/* Each step settles in rather than snapping: opacity only, short. */}
        <div
          key={`${step}-${copying?.id ?? ""}`}
          className="animate-[tanren-fade-in_180ms_var(--ease-out)]"
        >
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Choice({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="-mx-2 flex min-h-16 items-center gap-3 rounded-md border-b border-line px-2 py-3 text-left transition-[background-color,transform] duration-[160ms] ease-out hover:bg-ghost active:scale-[0.985]"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[17px] leading-snug font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

function TemplateList({ onStarted }: { onStarted: () => void }) {
  const templates = useTemplates();
  return (
    <ServerRead
      query={templates}
      offline={<OfflineLine>Templates need a connection to load.</OfflineLine>}
      error={(e, retry) => (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-[15px]">
            Couldn’t load the templates. {programErrorText(e)}
          </p>
          <Button onClick={retry}>Try again</Button>
        </div>
      )}
      skeleton={
        <div role="status" className="border-t border-line">
          <span className="sr-only">Loading templates</span>
          {[0, 1].map((n) => (
            <div
              key={n}
              aria-hidden="true"
              className="flex h-28 flex-col gap-3 border-b border-line py-4"
            >
              <span className="h-4 w-36 rounded-sm bg-line" />
              <span className="h-3.5 w-56 rounded-sm bg-line" />
            </div>
          ))}
        </div>
      }
    >
      {({ templates: list }) => (
        <Templates templates={list} onStarted={onStarted} />
      )}
    </ServerRead>
  );
}

function Templates({
  templates,
  onStarted,
}: {
  templates: TemplateSummary[];
  onStarted: () => void;
}) {
  const startProgram = useStartProgram();
  const online = useOnline();
  const [started, setStarted] = useState<string | null>(null);

  function start(template: TemplateSummary) {
    setStarted(template.slug);
    startProgram.mutate(template.slug, {
      onSuccess: ({ program }) => {
        toast(`${program.name} started`, {
          description: `${template.workouts[0]?.name ?? "Its first workout"} is up first.`,
        });
        onStarted();
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {startProgram.error ? (
        <p role="alert" className="text-[15px] font-medium text-danger">
          {programErrorText(startProgram.error)}
        </p>
      ) : null}
      {!online ? (
        <OfflineLine>Starting a program needs a connection.</OfflineLine>
      ) : null}
      <ul className="border-t border-line">
        {templates.map((t) => (
          <li
            key={t.slug}
            className="flex flex-col gap-3 border-b border-line py-4"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-[17px] leading-snug font-semibold">
                {t.name}
              </h3>
              <p className="text-sm text-muted-foreground">{t.description}</p>
            </div>
            <dl className="flex flex-col gap-1 text-sm">
              {t.workouts.map((w) => (
                <div key={w.name} className="flex gap-2">
                  <dt className="shrink-0 font-semibold">{w.name}</dt>
                  <dd className="min-w-0 truncate text-muted-foreground">
                    {w.exercises.map((e) => e.name).join(", ")}
                  </dd>
                </div>
              ))}
            </dl>
            <Button
              className="self-start"
              disabled={
                !online || (startProgram.isPending && started !== t.slug)
              }
              loading={startProgram.isPending && started === t.slug}
              onClick={() => start(t)}
            >
              Start {t.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyChooser({
  copying,
  onPick,
  onBack,
  onDone,
}: {
  copying: ProgramSummary | null;
  onPick: (program: ProgramSummary) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const programs = usePrograms();
  const online = useOnline();
  const list = programs.data?.programs ?? [];

  if (copying) {
    return (
      <CopyForm
        source={copying}
        programs={list}
        onDone={onDone}
        onCancel={onBack}
      />
    );
  }
  if (!programs.data) {
    return online ? (
      <p role="status" className="text-[15px] text-muted-foreground">
        Loading your programs…
      </p>
    ) : (
      <OfflineLine>Your programs load with a connection.</OfflineLine>
    );
  }
  if (list.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground">
        Nothing to copy yet. Start from a template or create one from scratch.
      </p>
    );
  }
  return (
    <ul className="border-t border-line">
      {list.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onPick(p)}
            className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-md border-b border-line px-2 py-2.5 text-left transition-[background-color,transform] duration-[160ms] ease-out hover:bg-ghost active:scale-[0.985]"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold">
                {p.name}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {STATUS_LABEL[p.status]} · {lengthLabel(p)}
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
