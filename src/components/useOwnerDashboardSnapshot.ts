import { useEffect, useState } from "react";
import { validateOwnerDashboardSnapshot, type OwnerDashboardSnapshot } from "../presentation/ownerDashboardSnapshot";

export function useOwnerDashboardSnapshot(url = "/public-data/owner-latest.json") {
  const [snapshot, setSnapshot] = useState<OwnerDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(url, { cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : null)
      .then((value: unknown) => {
        if (cancelled) return;
        if (value && validateOwnerDashboardSnapshot(value).length === 0) setSnapshot(value as OwnerDashboardSnapshot);
        else setSnapshot(null);
      })
      .catch(() => { if (!cancelled) setSnapshot(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { snapshot, loading };
}
