import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "./theme.js";

export { toast } from "sonner";

/**
 * The toast's look, shared with the kit's static specimen so the still and
 * the live toast cannot drift. The action is a 44px target: toasts land
 * mid-workout.
 */
export const toastClassNames = {
  toast:
    "flex w-[min(100%,24rem)] items-start gap-3 rounded-xl border border-line-2 bg-background px-4 py-3 font-sans text-[15px] text-foreground shadow-[0_12px_32px_-12px_var(--shadow)]",
  title: "font-semibold leading-snug",
  description: "mt-0.5 text-sm text-muted-foreground",
  icon: "mt-0.5 text-muted-foreground [&_svg]:size-4",
  actionButton:
    "ml-auto h-11 shrink-0 rounded-md border border-line-2 px-3.5 text-sm font-semibold text-foreground",
  cancelButton:
    "h-11 shrink-0 rounded-md border border-transparent px-3.5 text-sm font-semibold text-muted-foreground",
} as const;

/*
 * shadcn/ui's Sonner, restyled and unstyled at the root so nothing of the
 * library's own look leaks in. Top of the screen: the bottom belongs to the
 * Log set button. Sonner's region is aria-live, so sync news is announced.
 */
export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="top-center"
      gap={8}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        unstyled: true,
        classNames: toastClassNames,
      }}
      {...props}
    />
  );
}
