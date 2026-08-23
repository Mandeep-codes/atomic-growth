import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { site_settings } from "../lib/schema";
import { publicProcedure, router, sosRoleProcedure } from "../lib/trpc";
import {
  bustMaintenanceCache,
  getMaintenanceStatus,
} from "../lib/maintenance";

export const siteSettingsRouter = router({
  // Public: the frontend reads this (even unauthenticated) to decide whether
  // to show the maintenance screen. Cheap + cached.
  getMaintenanceStatus: publicProcedure.query(async () => {
    const status = await getMaintenanceStatus();
    return status;
  }),

  // SOS-only: flip the kill-switch. SOS users pass the maintenance gate in the
  // auth middleware, so this endpoint stays reachable even while maintenance
  // is ON — which is how they turn it back off.
  setMaintenanceMode: sosRoleProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        message: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(site_settings).limit(1);

      const values = {
        maintenance_mode_enabled: input.enabled,
        maintenance_mode_message: input.message ?? null,
        maintenance_enabled_at: input.enabled ? new Date() : null,
        maintenance_enabled_by: input.enabled ? ctx.user.id : null,
        updated_at: new Date(),
      };

      if (!existing) {
        await db.insert(site_settings).values(values);
      } else {
        await db
          .update(site_settings)
          .set(values)
          .where(eq(site_settings.id, existing.id));
      }

      // Take effect immediately rather than after the 15s cache TTL.
      bustMaintenanceCache();

      return await getMaintenanceStatus(true);
    }),
});
