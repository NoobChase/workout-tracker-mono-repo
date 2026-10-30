import { useLayoutEffect } from "react";
import { useNavigate } from "react-router";

type Navigate = (to: string, options: { replace: boolean }) => void;

let navigate: Navigate | null = null;

/**
 * How Clerk moves between its own steps (`/sign-in/factor-one`, …) and to
 * the page after signing in or out: through React Router, so the page never
 * reloads. `ClerkProvider` sits outside the router (it must stay mounted when
 * the landing page hands over), so it gets these two functions, and the
 * router hands them its `navigate` once mounted. Before that, a plain page
 * navigation is the honest fallback.
 */
export const clerkNavigation = {
  push: (to: string) => {
    if (navigate) navigate(to, { replace: false });
    else window.location.assign(to);
  },
  replace: (to: string) => {
    if (navigate) navigate(to, { replace: true });
    else window.location.replace(to);
  },
};

/** Inside the router: lends Clerk its `navigate`. Renders nothing. */
export function ClerkNavigation() {
  const routerNavigate = useNavigate();
  useLayoutEffect(() => {
    navigate = (to, options) => void routerNavigate(to, options);
    return () => {
      navigate = null;
    };
  }, [routerNavigate]);
  return null;
}
