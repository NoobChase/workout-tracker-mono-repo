import type { progressOf } from "./program-format.js";

/** "Cycle 3 of 12" with its numbers in mono; words otherwise. */
export function Progress({
  progress,
}: {
  progress: ReturnType<typeof progressOf>;
}) {
  if (progress.cycle === null) return <>{progress.text}</>;
  return (
    <span>
      Cycle <span className="num">{progress.cycle}</span>
      {progress.of !== null ? (
        <>
          {" "}
          of <span className="num">{progress.of}</span>
        </>
      ) : null}
    </span>
  );
}
