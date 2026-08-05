import { useEffect, useState } from "react";
import {
  loadPublicDashboardSnapshot,
  type PublicSnapshotLoadResult,
} from "../presentation/publicSnapshotTransport";

export type PublicDashboardSnapshotState = PublicSnapshotLoadResult & {
  loading: boolean;
};

const INITIAL_STATE: PublicDashboardSnapshotState = {
  snapshot: null,
  source: "not-available",
  observedFreshness: "NOT_AVAILABLE",
  errors: [],
  warnings: [],
  loading: true,
};

export function usePublicDashboardSnapshot(
  url = "/public-data/latest.json",
): PublicDashboardSnapshotState {
  const [state, setState] = useState<PublicDashboardSnapshotState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL_STATE);

    void loadPublicDashboardSnapshot({ url }).then((result) => {
      if (!cancelled) setState({ ...result, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
