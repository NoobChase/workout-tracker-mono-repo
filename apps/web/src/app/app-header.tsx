import { UserButton } from "@clerk/react";
import { Link } from "react-router";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Wordmark } from "@/ui/wordmark";
import { userButtonAppearance } from "./clerk-appearance.js";
import { SyncAlert, SyncLine } from "./sync-line.js";

/**
 * Every signed-in screen's header (DESIGN.md, Navigation): the wordmark home
 * at left, the theme toggle and account at right, and the sync line always
 * in view. From `sm` up the line sits in the bar; on a phone it takes its
 * own row under it, because the bar can't hold "3 sets queued, no signal"
 * beside the wordmark at 390px. One element either way, so it is one live
 * region.
 */
export function AppHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 md:px-9">
        <Link
          to="/"
          aria-label="Tanren, home"
          className="col-start-1 row-start-1 -mx-1 flex h-16 items-center rounded-md px-1"
        >
          <Wordmark />
        </Link>
        <div className="col-span-3 row-start-2 flex min-w-0 pb-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end sm:pb-0">
          <SyncLine />
        </div>
        <div className="col-start-3 row-start-1 flex items-center gap-2">
          <ThemeToggle />
          <span className="grid min-h-11 min-w-11 place-items-center">
            <UserButton appearance={userButtonAppearance} />
          </span>
        </div>
      </div>
      <SyncAlert />
    </header>
  );
}
