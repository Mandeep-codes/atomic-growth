import { eq } from "drizzle-orm";
import { db } from "./db";
import { roles, user_roles } from "./schema";

// Discord IDs that should hold the SOS (emergency maintenance) role.
// Looked up from user_clerk by the emails Pranav provided.
const SOS_DISCORD_IDS = [
  "605496244349042886", // arthur6ocdn@gmail.com  (Arthur_Z)
  "755628278298968075", // hanaankith@gmail.com   (Hannaan)
  "271131607426007050", // sebruizufl@gmail.com   (Seb)
  "1120034294463741972", // subah@totalgrowth.io  (Subah)
  "1121063081292861501", // tridentsocial284@...   (Vihaan)
  "296884557972504577", // Pranav (channelprnv)
];

// Ensures the "sos" role exists and is granted to the people above.
// Idempotent and fully wrapped in try/catch — it must NEVER throw, because it
// runs during server startup and a thrown error would crash the boot.
export async function seedSosRole() {
  try {
    let [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "sos"))
      .limit(1);

    if (!role) {
      await db.insert(roles).values({
        name: "sos",
        description: "Emergency SOS — toggle site-wide maintenance mode",
      });
      [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, "sos"))
        .limit(1);
    }

    if (!role) {
      console.error("seedSosRole: could not create/find the sos role");
      return;
    }

    for (const userId of SOS_DISCORD_IDS) {
      await db
        .insert(user_roles)
        .values({ user_id: userId, role_id: role.id })
        // unique (user_id, role_id) — no-op if already assigned
        .onDuplicateKeyUpdate({ set: { user_id: userId } });
    }

    console.log(
      `seedSosRole: ensured sos role + ${SOS_DISCORD_IDS.length} assignments`
    );
  } catch (err) {
    // Never crash startup over this.
    console.error("seedSosRole failed (non-fatal):", err);
  }
}
