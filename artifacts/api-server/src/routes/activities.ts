import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, activitiesTable } from "@workspace/db";
import {
  CreateActivityBody,
  GetActivityParams,
  DeleteActivityParams,
} from "@workspace/api-zod";
import { z } from "zod";

const PatchActivityBody = z.object({ name: z.string().min(1) });
const PatchActivityParams = z.object({ id: z.number().int().positive() });

const router: IRouter = Router();

function deviceId(req: import("express").Request): string {
  return (req.headers["x-device-id"] as string) || "default";
}

router.get("/activities", async (req, res): Promise<void> => {
  const did = deviceId(req);
  const activities = await db
    .select({
      id: activitiesTable.id,
      name: activitiesTable.name,
      date: activitiesTable.date,
      distanceKm: activitiesTable.distanceKm,
      durationSecs: activitiesTable.durationSecs,
      elevationGainM: activitiesTable.elevationGainM,
      avgPaceSecPerKm: activitiesTable.avgPaceSecPerKm,
      maxSpeedKmh: activitiesTable.maxSpeedKmh,
      type: activitiesTable.type,
    })
    .from(activitiesTable)
    .where(eq(activitiesTable.deviceId, did))
    .orderBy(desc(activitiesTable.date), desc(activitiesTable.createdAt));
  res.json(activities);
});

router.post("/activities", async (req, res): Promise<void> => {
  const parsed = CreateActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [activity] = await db
    .insert(activitiesTable)
    .values({
      name: parsed.data.name,
      date: parsed.data.date,
      distanceKm: parsed.data.distanceKm,
      durationSecs: parsed.data.durationSecs,
      elevationGainM: parsed.data.elevationGainM,
      avgPaceSecPerKm: parsed.data.avgPaceSecPerKm,
      maxSpeedKmh: parsed.data.maxSpeedKmh,
      type: parsed.data.type,
      points: parsed.data.points,
      deviceId: deviceId(req),
    })
    .returning();

  res.status(201).json(activity);
});

router.get("/activities/stats/summary", async (req, res): Promise<void> => {
  const did = deviceId(req);
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.deviceId, did));

  const totalActivities = activities.length;
  const totalDistanceKm = activities.reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const totalDurationSecs = activities.reduce((s, a) => s + (a.durationSecs ?? 0), 0);
  const totalElevationGainM = activities.reduce((s, a) => s + (a.elevationGainM ?? 0), 0);
  const longestRunKm = activities.reduce((m, a) => Math.max(m, a.distanceKm ?? 0), 0);
  const bestPaceSecPerKm = activities
    .filter((a) => a.avgPaceSecPerKm != null)
    .reduce((m, a) => (m === 0 ? (a.avgPaceSecPerKm ?? 0) : Math.min(m, a.avgPaceSecPerKm ?? 0)), 0);

  const activitiesByType: Record<string, number> = {};
  for (const a of activities) {
    activitiesByType[a.type] = (activitiesByType[a.type] ?? 0) + 1;
  }

  res.json({
    totalActivities,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalDurationSecs,
    totalElevationGainM: Math.round(totalElevationGainM),
    longestRunKm: Math.round(longestRunKm * 100) / 100,
    bestPaceSecPerKm,
    activitiesByType,
  });
});

router.get("/activities/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetActivityParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [activity] = await db
    .select()
    .from(activitiesTable)
    .where(and(eq(activitiesTable.id, params.data.id), eq(activitiesTable.deviceId, deviceId(req))));

  if (!activity) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }

  res.json(activity);
});

router.patch("/activities/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = PatchActivityParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = PatchActivityBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db
    .update(activitiesTable)
    .set({ name: body.data.name })
    .where(and(eq(activitiesTable.id, params.data.id), eq(activitiesTable.deviceId, deviceId(req))))
    .returning();

  if (!updated) { res.status(404).json({ error: "Activity not found" }); return; }
  res.json(updated);
});

router.delete("/activities/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteActivityParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(activitiesTable).where(
    and(eq(activitiesTable.id, params.data.id), eq(activitiesTable.deviceId, deviceId(req)))
  );
  res.sendStatus(204);
});

export default router;
