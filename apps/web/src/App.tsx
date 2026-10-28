import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AppHeader } from "./app/app-header.js";
import { AuthGate } from "./app/auth-gate.js";
import { ClerkBridge } from "./app/clerk-bridge.js";
import { UpdatePrompt } from "./app/update-prompt.js";
import { HomeScreen } from "./screens/home.js";
import { HistoryScreen, SessionDetailScreen } from "./screens/history.js";
import { WorkoutScreen } from "./screens/workout.js";
import { Button } from "@/ui/button";
import { Toaster } from "@/ui/toaster";

/**
 * The four screens (design D13), React Router in library mode. `/design` is
 * not here: the kit is development only and mounts outside the router
 * (main.tsx). CloudFront and the service worker both serve `/index.html` for
 * these paths.
 */
export function App() {
  return (
    <BrowserRouter>
      <ClerkBridge />
      <AuthGate>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/history/:sessionId" element={<SessionDetailScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthGate>
      <UpdatePrompt />
      <Toaster />
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col items-start gap-5 px-4 pt-10 pb-16 md:px-9">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">
          Nothing at this address
        </h1>
        <Button asChild>
          <Link to="/">Home</Link>
        </Button>
      </main>
    </>
  );
}
