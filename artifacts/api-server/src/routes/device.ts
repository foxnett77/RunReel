import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// POST /api/device/claim-default
// First device to call this gets ownership of the existing "default" data.
router.post("/device/claim-default", async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "default_claimed"));

  if (row) {
    res.json({ claimed: false });
    return;
  }

  await db.insert(appSettingsTable).values({ key: "default_claimed", value: "true" });
  res.json({ claimed: true });
});

export default router;
