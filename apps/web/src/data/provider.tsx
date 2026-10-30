import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ApiError } from "../api.js";
import type { DataLayer } from "../local/layer.js";
import { keys, refreshAfter } from "./queries.js";

const DataLayerContext = createContext<DataLayer | null>(null);

/**
 * The query client for server reads (what's next, templates, history) and
 * plan-side writes.
 */
export function createQueryClient(): QueryClientType {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx won't change by asking again; anything else might.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 3,
        staleTime: 30_000,
      },
      // Every mutation is a plan-side write, online only by design: it fails
      // at once offline (and says so) rather than pausing until signal.
      // Logging writes never come through here; they queue.
      mutations: { networkMode: "always" },
    },
  });
}

/**
 * Makes the data layer and the query client available to every screen, and
 * refreshes the server reads a delivered write changes (`AFFECTS`): a start
 * puts a session in what's next and trains its workout, a finish moves it
 * to history, and a finish or a skip moves what's next on and may change a
 * program's progress.
 */
export function DataProvider({
  layer,
  queryClient,
  children,
}: {
  layer: DataLayer;
  queryClient: QueryClientType;
  children: ReactNode;
}) {
  useEffect(
    () =>
      layer.onAck((item) => {
        void refreshAfter(queryClient, item.op);
        void queryClient.invalidateQueries({
          queryKey: keys.session(item.sessionId),
        });
      }),
    [layer, queryClient],
  );

  return (
    <DataLayerContext value={layer}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </DataLayerContext>
  );
}

export function useDataLayer(): DataLayer {
  const layer = useContext(DataLayerContext);
  if (!layer) throw new Error("useDataLayer needs a <DataProvider>");
  return layer;
}
