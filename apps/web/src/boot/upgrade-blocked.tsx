/**
 * Shown while the device's storage can't open because another tab still
 * holds an older version of it (a tab left open across a deploy). The open
 * is waiting, not failed: the moment that tab closes or reloads, this one
 * carries on by itself. Small and dependency-free, since the bootstrap
 * shows it before any chunk loads.
 */
export function UpgradeBlocked() {
  return (
    <div role="status" className="mx-auto max-w-[30rem] px-4 pt-16">
      <p className="text-[17px] font-semibold">
        Tanren is open in another tab.
      </p>
      <p className="mt-2 text-[15px] text-muted-foreground">
        That tab is running an older version, and this one can’t update your
        on-device storage until it closes. Close or reload the other tab and
        this page carries on. Nothing you’ve logged is lost.
      </p>
    </div>
  );
}
