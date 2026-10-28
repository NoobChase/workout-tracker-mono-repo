import { useEffect } from "react";
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

  return null;
}
