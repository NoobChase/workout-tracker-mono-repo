import type { Theme } from "@/ui/theme.js";
import { ThemeToggle } from "@/ui/theme-toggle.js";
import { Toaster } from "@/ui/toaster.js";
import { Wordmark } from "@/ui/wordmark.js";
import { LiveSetDemo } from "./live-set-demo.js";
import { Specimens } from "./specimens.js";

/**
 * /design, development builds only (see main.tsx). Opens on a working live
 * set, then shows every primitive in both themes at once.
 */
export function DesignKit() {
  return (
    <>
      <header className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 border-b border-line px-4 md:px-9">
        <Wordmark />
        <span className="hidden text-sm text-faint sm:inline">
          Design kit, development only
        </span>
        <ThemeToggle className="ml-auto" />
      </header>

      <main>
        <div className="mx-auto max-w-[1280px] px-4 pt-5 pb-16 md:px-9 md:pt-10 md:pb-24">
          <LiveSetDemo />
        </div>

        <div className="border-t border-line">
          <div className="mx-auto max-w-[1280px] px-4 pt-14 pb-20 md:px-9 md:pt-20">
            <div className="mb-10 flex flex-col gap-2">
              <h2 className="text-[32px] leading-tight font-bold tracking-[-0.02em] text-balance">
                Every primitive, in every state
              </h2>
              <p className="max-w-[60ch] text-[17px] text-muted-foreground">
                Light and dark at once, each pane pinned to its theme. Every
                number on this page is demo data.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Pane theme="light" />
              <Pane theme="dark" />
            </div>
          </div>
        </div>
      </main>

      <footer className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-2 border-t border-line px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-[13px] text-faint md:px-9">
        <span>Tanren design kit</span>
        <span>Not part of the production build</span>
      </footer>

      <Toaster />
    </>
  );
}

function Pane({ theme }: { theme: Theme }) {
  const name = theme === "light" ? "Light" : "Dark";
  return (
    <section
      data-theme={theme}
      aria-label={`${name} theme`}
      className="min-w-0 rounded-xl border border-line-2 bg-background px-4 pt-5 text-foreground sm:px-7"
    >
      <p className="pb-5 text-[15px] font-semibold">{name}</p>
      <Specimens theme={theme} />
    </section>
  );
}
