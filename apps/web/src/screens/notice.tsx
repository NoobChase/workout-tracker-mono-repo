import { CloudOff } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A screen-level message in place of content: a problem (an alert, with the
 * recovery as its action) or, with `offline`, a plain status that the content
 * needs a connection.
 */
export function Notice({
  children,
  offline = false,
  action,
}: {
  children: ReactNode;
  offline?: boolean;
  action?: ReactNode;
}) {
  return (
    <div
      role={offline ? "status" : "alert"}
      className="flex max-w-[60ch] flex-col items-start gap-4 border-t border-line pt-5"
    >
      <p className="flex gap-2 text-[15px] text-foreground">
        {offline ? (
          <CloudOff
            aria-hidden="true"
            strokeWidth={1.75}
            className="mt-1 size-4 shrink-0 text-muted-foreground"
          />
        ) : null}
        <span>{children}</span>
      </p>
      {action}
    </div>
  );
}
