import { UserButton } from "@clerk/react";
import { BookOpen } from "lucide-react";
import { Link, NavLink } from "react-router";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Wordmark } from "@/ui/wordmark";
import { userButtonAppearance } from "./clerk-appearance.js";
import { SyncAlert, SyncLine } from "./sync-line.js";

/**
 * Every signed-in screen's header (DESIGN.md, Navigation; brief
 * `apps-web-src-home`): the wordmark home, then the quiet text links
 * Programs and History, then the theme toggle and account (its menu:
 * Manage account, About Tanren, Sign out), with the sync
 * line always in view. From `sm` up the line sits in the bar; on a phone it
 * takes its own row under it, because the bar can't hold "3 sets queued, no
 * signal" beside the links at 390px, and the theme toggle shows its glyph
 * alone. One element either way, so it is one live region.
 */
export function AppHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 md:gap-x-5 md:px-9">
        <Link
          to="/"
          aria-label="Tanren, home"
          className="col-start-1 row-start-1 -mx-1 flex h-16 items-center rounded-md px-1"
        >
          <Wordmark />
        </Link>
        <nav
          aria-label="Main"
          className="col-start-2 row-start-1 flex items-center"
        >
          <HeaderLink to="/programs">Programs</HeaderLink>
          <HeaderLink to="/history">History</HeaderLink>
        </nav>
        <div className="col-span-4 row-start-2 flex min-w-0 pb-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end sm:pb-0">
          <SyncLine />
        </div>
        <div className="col-start-4 row-start-1 flex items-center gap-2">
          <ThemeToggle compactOnPhone />
          <span className="grid min-h-11 min-w-11 place-items-center">
            {/* The account menu carries the way to the landing page, so the
                header's links stay the two places a lifter goes daily. */}
            <UserButton appearance={userButtonAppearance}>
              <UserButton.MenuItems>
                <UserButton.Action label="manageAccount" />
                <UserButton.Link
                  label="About Tanren"
                  labelIcon={
                    <BookOpen
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-4"
                    />
                  }
                  href="/about"
                />
                <UserButton.Action label="signOut" />
              </UserButton.MenuItems>
            </UserButton>
          </span>
        </div>
      </div>
      <SyncAlert />
    </header>
  );
}

/**
 * A quiet text link: muted ink, ink on hover; the current page is ink with
 * a hairline underline (copper stays on the primary action).
 */
function HeaderLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex h-11 items-center rounded-md px-2.5 text-sm font-medium no-underline transition-colors duration-150",
          "hover:text-foreground",
          isActive
            ? "text-foreground underline decoration-edge decoration-1 underline-offset-[6px]"
            : "text-muted-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}
