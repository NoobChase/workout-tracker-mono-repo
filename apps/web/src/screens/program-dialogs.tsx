import type { ProgramSummary } from "@workout-tracker/shared";
import { useId, useState, type FormEvent } from "react";
import {
  useOnline,
  useProgramActions,
  type ProgramList,
} from "../data/hooks.js";
import { OfflineLine } from "./notice.js";
import {
  lengthLabel,
  programErrorText,
  suggestCopyName,
} from "./program-format.js";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { toast } from "@/ui/toaster";

/*
 * The two program writes that take a name: rename (an exact clash is
 * refused, naming it) and copy (a free name is suggested and can be changed
 * in the same flow; a taken one is suffixed by the server). Both are
 * plan-side, so online only; offline the submit is disabled and says why.
 */

function NameField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RenameDialog({
  program,
  onOpenChange,
}: {
  program: ProgramSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={program !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {program ? (
          <RenameForm
            key={program.id}
            program={program}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  program,
  onDone,
}: {
  program: ProgramSummary;
  onDone: () => void;
}) {
  const { rename } = useProgramActions();
  const online = useOnline();
  const id = useId();
  const [name, setName] = useState(program.name);
  const trimmed = name.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === program.name) return onDone();
    rename.mutate(
      { programId: program.id, name: trimmed },
      {
        onSuccess: ({ program: renamed }) => {
          toast(`Renamed to ${renamed.name}`);
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Rename {program.name}</DialogTitle>
        <DialogDescription>
          The new name shows everywhere, history included.
        </DialogDescription>
      </DialogHeader>
      <NameField
        id={id}
        value={name}
        onChange={(v) => {
          setName(v);
          rename.reset();
        }}
        error={rename.error ? programErrorText(rename.error) : null}
      />
      {online ? null : (
        <OfflineLine>Changing programs needs a connection.</OfflineLine>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!online || trimmed === ""}
          loading={rename.isPending}
        >
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CopyDialog({
  program,
  programs,
  onOpenChange,
}: {
  program: ProgramSummary | null;
  programs: ProgramList;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={program !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {program ? (
          <CopyForm
            key={program.id}
            source={program}
            programs={programs}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
            inDialog
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** What a copy is, for the copy form's heading (operations.md 3.9). */
export function copyDescription(source: ProgramSummary): string {
  return `A new draft built from its first cycle, ${lengthLabel(source).toLowerCase()}. The original and its history stay as they are.`;
}

/**
 * Copy one program into a new, independent draft (operations.md 3.9), with
 * its name editable before it is made. Used in the dialog and in the New
 * program sheet.
 */
export function CopyForm({
  source,
  programs,
  onDone,
  onCancel,
  inDialog = false,
}: {
  source: ProgramSummary;
  programs: ProgramList;
  onDone: () => void;
  onCancel: () => void;
  inDialog?: boolean;
}) {
  const { copy } = useProgramActions();
  const online = useOnline();
  const id = useId();
  const [name, setName] = useState(() =>
    suggestCopyName(
      source.name,
      programs.map((p) => p.name),
    ),
  );
  const trimmed = name.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    copy.mutate(
      { programId: source.id, name: trimmed },
      {
        onSuccess: ({ program }) => {
          toast(`Copied as ${program.name}`, {
            description: "It’s under Drafts until you activate it.",
          });
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      {/* In the sheet, the sheet's own title and description say this. */}
      {inDialog ? (
        <DialogHeader>
          <DialogTitle>Copy {source.name}</DialogTitle>
          <DialogDescription>{copyDescription(source)}</DialogDescription>
        </DialogHeader>
      ) : null}
      <NameField
        id={id}
        value={name}
        onChange={(v) => {
          setName(v);
          copy.reset();
        }}
        error={copy.error ? programErrorText(copy.error) : null}
      />
      {online ? null : (
        <OfflineLine>Changing programs needs a connection.</OfflineLine>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {inDialog ? "Cancel" : "Back"}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!online || trimmed === ""}
          loading={copy.isPending}
        >
          Make the copy
        </Button>
      </div>
    </form>
  );
}
