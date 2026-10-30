import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AppHeader } from "./app/app-header.js";
import { AboutPage, AuthGate, AuthPage } from "./app/auth-gate.js";
import { ClerkBridge } from "./app/clerk-bridge.js";
import { ClerkNavigation } from "./app/clerk-navigation.js";
import { UpdatePolicy, UpdatePrompt } from "./app/update-prompt.js";
import { HomeScreen } from "./screens/home.js";
import {
  CycleEditorScreen,
  NewProgramScreen,
} from "./screens/builder/routes.js";
import { ExercisesScreen } from "./screens/exercises.js";
import { HistoryScreen, SessionDetailScreen } from "./screens/history.js";
import { ProgramDetailScreen } from "./screens/program-detail.js";
import { ProgramsScreen } from "./screens/programs.js";
import { WorkoutScreen } from "./screens/workout/workout.js";
import { Button } from "@/ui/button";
import { Toaster } from "@/ui/toaster";

/**
 * The screens (design D13; Programs, the builder, program detail and the
 * exercise catalog from step 4a)
 * behind `AuthGate`, and Clerk's sign-in and
 * sign-up in front of it, React Router in library mode. `/design` is not
 * here: the kit is development only and mounts outside the router
 * (main.tsx). CloudFront and the service worker both serve `/index.html` for
 * these paths. Signed out, `/` is the landing page (`AuthGate`); `/about`
 * is the landing page for everyone, signed in or not.
 */
export function App() {
  return (
    <BrowserRouter>
      <ClerkNavigation />
      <ClerkBridge />
      <Routes>
        <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
        <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
        <Route path="/about" element={<AboutPage />} />
        <Route element={<AuthGate />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/history/:sessionId" element={<SessionDetailScreen />} />
          <Route path="/programs" element={<ProgramsScreen />} />
          <Route path="/programs/new" element={<NewProgramScreen />} />
          <Route path="/programs/:id" element={<ProgramDetailScreen />} />
          <Route
            path="/programs/:id/cycles/:n"
            element={<CycleEditorScreen />}
          />
          <Route path="/exercises" element={<ExercisesScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <UpdatePolicy />
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
