import { Ellipsis, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge.js";
import { Button } from "@/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardRow,
  CardTitle,
} from "@/ui/card.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  dialogShadow,
  overlayClose,
  overlayDescription,
  overlaySurface,
  overlayTitle,
} from "@/ui/dialog.js";
import { EmptyState } from "@/ui/empty-state.js";
import { Input } from "@/ui/input.js";
import { Label } from "@/ui/label.js";
import { NumberStepper } from "@/ui/number-stepper.js";
import { SetFigures, SetLog, SetRow, SetStatusText } from "@/ui/set-row.js";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  sheetSurface,
} from "@/ui/sheet.js";
import { SyncStatus } from "@/ui/sync-status.js";
import type { Theme } from "@/ui/theme.js";
import { ThemeToggle } from "@/ui/theme-toggle.js";
import { toast, toastClassNames } from "@/ui/toaster.js";
import { Wordmark } from "@/ui/wordmark.js";

/** The keyboard focus ring, forced on so a still can show it. */
const FOCUSED = "outline-2 outline-offset-3 outline-ring";
const FOCUSED_FIELD =
  "[&_[data-slot=stepper-field]]:border-ring [&_[data-slot=stepper-field]]:outline-2 [&_[data-slot=stepper-field]]:outline-offset-3 [&_[data-slot=stepper-field]]:outline-ring";

const SYNCED = {
  title: "2 sets synced",
  description: "Saved to your log, in the order you lifted them.",
};
const EDIT_NOTE = {
  description: "In the app this opens the set in a sheet, to edit or delete.",
};
const NO_SIGNAL = {
  title: "No signal",
  description: "Sets you log will queue in order and sync later.",
};

/** One theme's worth of every primitive in every state. */
export function Specimens({ theme }: { theme: Theme }) {
  return (
    <div className="flex flex-col">
      <Specimen title="Button">
        <Row>
          <Button variant="primary">Log set</Button>
          <Button variant="secondary">Substitute exercise</Button>
          <Button variant="ghost">Skip exercise</Button>
          <Button variant="destructive">Delete account</Button>
        </Row>
        <Row>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="primary" disabled>
            Log set
          </Button>
          <Button variant="secondary" disabled>
            Substitute exercise
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="More for this set"
          >
            <Ellipsis strokeWidth={1.75} />
          </Button>
        </Row>
        <Row>
          <Button size="sm">Small, 36px</Button>
          <Button size="md">Default, 48px</Button>
        </Row>
        <Button variant="primary" size="log" className="w-full">
          Log set, 56px
        </Button>
        <Note>
          Small is for planning screens, never a control used mid&#8209;workout.
        </Note>
      </Specimen>

      <Specimen title="Number stepper">
        <StepperSpecimens />
      </Specimen>

      <Specimen title="Input and label">
        <FieldSpecimens />
      </Specimen>

      <Specimen title="Keyboard focus">
        <FocusStills />
      </Specimen>

      <Specimen title="Badge">
        <Row>
          <Badge variant="warmup" />
          <Badge variant="drop" />
          <Badge variant="unit">lb</Badge>
          <Badge variant="unit">kg</Badge>
        </Row>
        <Note>
          A dashed edge marks a set that doesn’t count toward totals, charts or
          PRs.
        </Note>
      </Specimen>

      <Specimen title="Card">
        <Card>
          <CardHeader>
            <CardTitle>Last session</CardTitle>
            <CardDescription>Back Squat · Cycle 3 · demo data</CardDescription>
          </CardHeader>
          <CardContent>
            <CardRow
              label={<CardSet n={1} weight={220} reps={5} />}
              value={<SetStatusText status="logged" />}
            />
            <CardRow
              label={<CardSet n={2} weight={220} reps={5} />}
              value={<SetStatusText status="logged" />}
            />
            <CardRow
              label={<CardSet n={3} weight={220} reps={4} />}
              value="1 rep short of plan"
            />
          </CardContent>
          <CardFooter>
            <Button>Open session</Button>
          </CardFooter>
        </Card>
      </Specimen>

      <Specimen title="Set row">
        <SetLog aria-label="Set row states, no signal">
          <SetRow
            index={1}
            weight={135}
            reps={5}
            unit="lb"
            kind="warmup"
            status="logged"
          />
          <SetRow index={2} weight={225} reps={5} unit="lb" status="logged" />
          <SetRow index={3} weight={225} reps={5} unit="lb" status="queued" />
          <SetRow index={4} weight={225} reps={5} unit="lb" status="live" />
          <SetRow index={5} weight={225} reps={5} unit="lb" status="planned" />
          <SetRow
            index={6}
            weight={185}
            reps={8}
            unit="lb"
            kind="drop"
            status="planned"
          />
        </SetLog>
        <Note>Logged, queued with no signal, live, planned. Demo data.</Note>
        <SetLog aria-label="Set row states, retrying">
          <SetRow index={3} weight={225} reps={5} unit="lb" status="failed" />
          <SetRow
            index={4}
            weight={225}
            reps={5}
            unit="lb"
            status="queued"
            queuedReason="in-order"
          />
        </SetLog>
        <Note>
          Signal back, a send failing: the set retries, and the ones after it
          wait their turn.
        </Note>
        <SetLog aria-label="Set row states, rejected and editable">
          <SetRow
            index={1}
            weight={225}
            reps={5}
            unit="lb"
            status="logged"
            onPress={() => toast("Edit set 1", EDIT_NOTE)}
          />
          <SetRow
            index={2}
            weight={2250}
            reps={5}
            unit="lb"
            status="rejected"
            reason="That weight is more than 2,000 lb, so it wasn’t saved."
            onPress={() => toast("Edit set 2", EDIT_NOTE)}
          />
          <SetRow
            index={3}
            weight={225}
            reps={5}
            unit="lb"
            status="queued"
            queuedReason="in-order"
            onPress={() => toast("Edit set 3", EDIT_NOTE)}
          />
          <SetRow index={4} weight={null} reps={8} unit="lb" status="live" />
        </SetLog>
        <Note>
          The server refused a set for good: it says rejected, with the server’s
          reason on the line, and the sets behind it wait. Logged rows are one
          button each, to edit. The live row of a first-time exercise leaves the
          weight as a blank to fill.
        </Note>
      </Specimen>

      <Specimen title="Sync status">
        <div className="flex flex-col items-start gap-2">
          <SyncStatus state="synced" />
          <SyncStatus state="syncing" pending={2} />
          <SyncStatus state="offline" pending={3} />
          <SyncStatus state="offline" workout />
          <SyncStatus state="retrying" pending={1} />
          <SyncStatus state="rejected" pending={1} />
          <SyncStatus state="held" pending={2} />
        </div>
        <Note>
          Counted in sets, never raw writes; a start or finish waiting alone is
          the workout. Rejected stops the queue; on hold waits for the right
          account to sign in. The app adds a band under the header with the
          reason and what to do.
        </Note>
      </Specimen>

      <Specimen title="Toast">
        <Row>
          <Button onClick={() => toast(SYNCED.title, SYNCED)}>
            Sync toast
          </Button>
          <Button onClick={() => toast(NO_SIGNAL.title, NO_SIGNAL)}>
            Offline toast
          </Button>
        </Row>
        <Still>
          <ToastStill {...SYNCED} />
          <ToastStill {...NO_SIGNAL} />
        </Still>
      </Specimen>

      <Specimen title="Sheet and dialog">
        <Row>
          <SubstituteSheet theme={theme} />
          <FinishDialog theme={theme} />
        </Row>
        <Still>
          <Stage>
            <div
              className={cn(
                overlaySurface,
                dialogShadow,
                "relative grid w-full max-w-md gap-5 p-6",
              )}
            >
              <FinishCopy />
              <span className={overlayClose}>
                <X aria-hidden="true" strokeWidth={1.75} className="size-5" />
              </span>
            </div>
          </Stage>
          <Stage sheet>
            <div
              className={cn(sheetSurface, "relative flex w-full flex-col pb-6")}
            >
              <SubstituteCopy />
              <span className={overlayClose}>
                <X aria-hidden="true" strokeWidth={1.75} className="size-5" />
              </span>
            </div>
          </Stage>
        </Still>
      </Specimen>

      <Specimen title="Theme toggle and wordmark">
        <Row className="justify-between">
          <Wordmark />
          <ThemeToggle />
        </Row>
        <Note>
          The toggle sets the whole page; each pane here is pinned to its own
          theme.
        </Note>
      </Specimen>

      <Specimen title="Empty state">
        <EmptyState
          title="No sets logged yet"
          action={<Button variant="primary">Start today’s workout</Button>}
        >
          Start a workout from your program and each set you log is ruled in
          here, in order.
        </EmptyState>
      </Specimen>
    </div>
  );
}

/** A set as a card names it: the label in Albert Sans, numbers in mono. */
function CardSet({
  n,
  weight,
  reps,
}: {
  n: number;
  weight: number;
  reps: number;
}) {
  return (
    <>
      <span className="w-10 text-muted-foreground">Set {n}</span>
      <SetFigures weight={weight} reps={reps} unit="lb" className="text-sm" />
    </>
  );
}

function StepperSpecimens() {
  const [lb, setLb] = useState(225);
  const [kg, setKg] = useState(102.5);
  const [reps, setReps] = useState(5);
  const [floor, setFloor] = useState(0);
  const [ceiling, setCeiling] = useState(100);
  const [blank, setBlank] = useState<number | null>(null);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberStepper
        label="Weight"
        unit="lb"
        decimal
        step={5}
        max={2000}
        value={lb}
        onValueChange={setLb}
      />
      <NumberStepper
        label="Weight"
        unit="kg"
        decimal
        step={2.5}
        max={1000}
        value={kg}
        onValueChange={setKg}
      />
      <NumberStepper
        label="Reps"
        unit="reps"
        step={1}
        max={100}
        value={reps}
        onValueChange={setReps}
      />
      <NumberStepper
        label="Reps, at zero"
        unit="reps"
        step={1}
        max={100}
        value={floor}
        onValueChange={setFloor}
      />
      <NumberStepper
        label="Reps, at the maximum"
        unit="reps"
        step={1}
        max={100}
        value={ceiling}
        onValueChange={setCeiling}
      />
      <NumberStepper
        label="Weight, first time"
        unit="lb"
        decimal
        step={5}
        max={2000}
        value={blank}
        onValueChange={setBlank}
      />
      <NumberStepper
        label="Weight, disabled"
        unit="lb"
        step={5}
        value={225}
        onValueChange={() => {}}
        disabled
      />
    </div>
  );
}

function FieldSpecimens() {
  const id = useId();
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field>
        <Label htmlFor={`${id}-name`}>Exercise name</Label>
        <Input id={`${id}-name`} defaultValue="Back Squat" />
      </Field>
      <Field>
        <Label htmlFor={`${id}-note`}>Setup and cues</Label>
        <Input id={`${id}-note`} placeholder="Pins at 14, belt on" />
      </Field>
      <Field>
        <Label htmlFor={`${id}-bad`}>Weight</Label>
        <Input
          id={`${id}-bad`}
          defaultValue="22o"
          aria-invalid="true"
          aria-describedby={`${id}-bad-error`}
        />
        <p id={`${id}-bad-error`} className="text-sm text-danger">
          Enter a weight in lb, like 225.
        </p>
      </Field>
      <Field>
        <Label htmlFor={`${id}-off`}>Program name</Label>
        <Input id={`${id}-off`} defaultValue="Strength Block" disabled />
      </Field>
    </div>
  );
}

/** Focused-looking controls, held still so the copper ring can be checked. */
function FocusStills() {
  const id = useId();
  return (
    <Still>
      <Row>
        <Button variant="primary" className={FOCUSED}>
          Log set
        </Button>
        <Button className={FOCUSED}>Substitute exercise</Button>
      </Row>
      <Field>
        <Label htmlFor={`${id}-focus`}>Exercise name</Label>
        <Input
          id={`${id}-focus`}
          defaultValue="Back Squat"
          className={cn("border-ring", FOCUSED)}
        />
      </Field>
      <NumberStepper
        label="Weight"
        unit="lb"
        step={5}
        value={225}
        onValueChange={() => {}}
        className={FOCUSED_FIELD}
      />
    </Still>
  );
}

function ToastStill({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={toastClassNames.toast}>
      <div className="min-w-0">
        <div className={toastClassNames.title}>{title}</div>
        <div className={toastClassNames.description}>{description}</div>
      </div>
    </div>
  );
}

function FinishCopy() {
  return (
    <>
      <div className="flex flex-col gap-2 pr-10">
        <h4 className={overlayTitle}>Finish with 2 sets left?</h4>
        <p className={overlayDescription}>
          3 of 5 Back Squat sets are logged. The sets you didn’t do stay
          unlogged, and your program doesn’t change.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button>Keep training</Button>
        <Button variant="primary">Finish workout</Button>
      </div>
    </>
  );
}

function SubstituteCopy() {
  const id = useId();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 pr-10">
        <h4 className={overlayTitle}>Substitute Back Squat</h4>
        <p className={overlayDescription}>
          For today’s session only. The plan stays the plan.
        </p>
      </div>
      <Field>
        <Label htmlFor={`${id}-search`}>Exercise</Label>
        <Input id={`${id}-search`} placeholder="Search exercises" />
      </Field>
      <Button variant="primary" size="log" className="w-full">
        Use Front Squat
      </Button>
    </div>
  );
}

function SubstituteSheet({ theme }: { theme: Theme }) {
  const id = useId();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Substitute exercise</Button>
      </SheetTrigger>
      <SheetContent data-theme={theme}>
        <SheetHeader>
          <SheetTitle>Substitute Back Squat</SheetTitle>
          <SheetDescription>
            For today’s session only. The plan stays the plan.
          </SheetDescription>
        </SheetHeader>
        <Field>
          <Label htmlFor={`${id}-search`}>Exercise</Label>
          <Input id={`${id}-search`} placeholder="Search exercises" />
        </Field>
        <SheetClose asChild>
          <Button variant="primary" size="log" className="w-full">
            Use Front Squat
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

function FinishDialog({ theme }: { theme: Theme }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Finish workout</Button>
      </DialogTrigger>
      <DialogContent data-theme={theme}>
        <DialogHeader>
          <DialogTitle>Finish with 2 sets left?</DialogTitle>
          <DialogDescription>
            3 of 5 Back Squat sets are logged. The sets you didn’t do stay
            unlogged, and your program doesn’t change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Keep training</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary">Finish workout</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A held-open copy for inspection: inert, so it is neither focusable nor
 * announced. The live version is the trigger above it.
 */
function Still({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div inert className="flex flex-col gap-4">
        {children}
      </div>
      <Note>Held open for inspection; not interactive.</Note>
    </div>
  );
}

/** A patch of page under the overlay scrim, the way a real overlay sits. */
function Stage({
  sheet = false,
  children,
}: {
  sheet?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-lg border border-line bg-background",
        sheet
          ? "items-end px-3 pt-16"
          : "items-center justify-center p-4 py-10",
      )}
    >
      <div aria-hidden="true" className="absolute inset-0">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
          <div key={n} className="h-11 border-b border-line" />
        ))}
        <div className="absolute inset-0 bg-scrim" />
      </div>
      <div className="relative flex w-full justify-center">{children}</div>
    </div>
  );
}

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5 pb-9">
      <h3 className="text-[15px] font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      {children}
    </div>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
