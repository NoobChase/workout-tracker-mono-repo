import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ApiError } from "../api.js";
import type { DataLayer } from "../local/layer.js";

const DataLayerContext = createContext<DataLayer | null>(null);

/** The query client for server reads (what's next, templates, history). */
export function createQueryClient(): QueryClientType {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx won't change by asking again; anything else might.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 3,
        staleTime: 30_000,
      },
    },
  });
}

/**
 * Makes the data layer and the query client available to every screen, and
 * refreshes the server reads a delivered write changes: a start puts a
 * session in what's next, a finish moves it to history.
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
        if (item.op === "start" || item.op === "finish") {
          void queryClient.invalidateQueries({ queryKey: ["next"] });
        }
        if (item.op === "finish") {
          void queryClient.invalidateQueries({ queryKey: ["history"] });
        }
        void queryClient.invalidateQueries({
          queryKey: ["session", item.sessionId],
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
