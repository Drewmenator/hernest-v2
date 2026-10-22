// ─── Extras (optional parts of the app) ────────────────────────────
// Trips is an Extra: off for new users, on for anyone who already saved a
// trip (so nobody loses something they rely on). The choice lives on the
// profile as extras.trips; until it is set, saved trips decide.
import { useEffect, useState } from "react";
import { useStore } from "../../core/store";
import { loadData, saveData } from "../../core/firebase";

export function useTripsEnabled(): boolean {
  const uid = useStore(s => s.user?.uid);
  const chosen = useStore(s => s.profile?.extras?.trips);
  const [hasTrips, setHasTrips] = useState(false);

  useEffect(() => {
    if (!uid || chosen !== undefined) return;
    let alive = true;
    loadData(uid, "trips").then(d => {
      const any = ((d?.trips as unknown[]) || []).length > 0;
      if (!alive) return;
      setHasTrips(any);
      // Remember it, so deleting the last trip later doesn't hide Trips.
      if (any) setTripsEnabled(uid, true).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid, chosen]);

  return chosen ?? hasTrips;
}

export async function setTripsEnabled(uid: string, on: boolean): Promise<void> {
  const st = useStore.getState();
  const extras = { ...(st.profile?.extras || {}), trips: on };
  st.updateProfile({ extras });
  await saveData(uid, "profile", { extras });
}
