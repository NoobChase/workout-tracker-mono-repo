import { useEffect } from "react";
import { onLocalDbEvent } from "../local/db.js";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "@/ui/toaster";

const TOAST_ID = "tanren-update";

/**
 * A new version is installed and waiting (`registerType: "prompt"`, design
 * D13): it never reloads on its own, so nobody loses their place mid-set.
 * It says so as a toast that stays until answered, at the top, where toasts
 * land (the bottom belongs to Log set). Reloading loses nothing: the record
 * and the queue live in IndexedDB.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    toast("A new version of Tanren is ready", {
      id: TOAST_ID,
      description: "Reload when it suits you. Nothing you’ve logged is lost.",
      duration: Infinity,
      action: { label: "Reload", onClick: () => void updateServiceWorker() },
      cancel: { label: "Later", onClick: () => setNeedRefresh(false) },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  // A newer version opened in another tab and took the device's storage
  // (this tab's connection closed itself so the upgrade isn't held up).
  // Same toast, one tap: reloading brings this tab onto that version.
  useEffect(
    () =>
      onLocalDbEvent((event) => {
        if (event.kind !== "replaced") return;
        toast("Tanren was updated in another tab", {
          id: TOAST_ID,
          description:
            "Reload this tab to keep going. Nothing you’ve logged is lost.",
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
      }),
    [],
  );

  return null;
}
