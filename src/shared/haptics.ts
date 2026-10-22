// ─── Haptics ───────────────────────────────────────────────────────
// Light taps under the finger on iPhone, the way native apps feel.
// Does nothing on the web or on an app build without the plugin; a
// failed buzz must never break the action it belongs to.
import { Capacitor } from "@capacitor/core";

type Kind = "tap" | "select" | "success" | "warning" | "pull";

let mod: Promise<typeof import("@capacitor/haptics")> | null = null;
const load = () => (mod ||= import("@capacitor/haptics"));

export function haptic(kind: Kind = "tap"): void {
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Haptics")) return;
  } catch { return; }
  load().then(({ Haptics, ImpactStyle, NotificationType }) => {
    switch (kind) {
      case "tap":     return Haptics.impact({ style: ImpactStyle.Light });
      case "pull":    return Haptics.impact({ style: ImpactStyle.Medium });
      case "select":  return Haptics.selectionChanged();
      case "success": return Haptics.notification({ type: NotificationType.Success });
      case "warning": return Haptics.notification({ type: NotificationType.Warning });
    }
  }).catch(() => {});
}
