import { db } from "./db";
import { site_settings } from "./schema";

export type MaintenanceStatus = {
  enabled: boolean;
  message: string | null;
  enabledBy: string | null;
  enabledAt: Date | null;
};

const DEFAULT_STATUS: MaintenanceStatus = {
  enabled: false,
  message: null,
  enabledBy: null,
  enabledAt: null,
};

// The maintenance flag is read on (nearly) every authenticated request, so we
// cache it in-memory with a short TTL instead of hitting the DB each time.
// setMaintenanceMode busts the cache so toggles take effect immediately.
const TTL_MS = 15_000;
let cache: { value: MaintenanceStatus; at: number } | null = null;

export async function getMaintenanceStatus(
  force = false
): Promise<MaintenanceStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  try {
    const [row] = await db.select().from(site_settings).limit(1);
    const value: MaintenanceStatus = {
      enabled: row?.maintenance_mode_enabled ?? false,
      message: row?.maintenance_mode_message ?? null,
      enabledBy: row?.maintenance_enabled_by ?? null,
      enabledAt: row?.maintenance_enabled_at ?? null,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch (err) {
    // If the settings table can't be read, fail OPEN (site stays usable) so a
    // DB hiccup can never accidentally lock everyone out.
    console.error("getMaintenanceStatus failed; defaulting to OFF:", err);
    return DEFAULT_STATUS;
  }
}

export function bustMaintenanceCache() {
  cache = null;
}
