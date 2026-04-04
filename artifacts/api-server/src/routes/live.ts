import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, activitiesTable } from "@workspace/db";
import {
  GetLiveSessionParams,
  StopLiveSessionParams,
  AddLivePointParams,
  AddLivePointBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

interface LiveSessionData {
  sessionId: string;
  startedAt: string;
  points: TrackPoint[];
  distanceKm: number;
  durationSecs: number;
  currentPaceSecPerKm: number;
  isActive: boolean;
}

const liveSessions = new Map<string, LiveSessionData>();

function haversineKm(p1: TrackPoint, p2: TrackPoint): number {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.post("/live/session", async (_req, res): Promise<void> => {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const session: LiveSessionData = {
    sessionId,
    startedAt: now,
    points: [],
    distanceKm: 0,
    durationSecs: 0,
    currentPaceSecPerKm: 0,
    isActive: true,
  };
  liveSessions.set(sessionId, session);
  res.status(201).json(session);
});

router.get("/live/session/:sessionId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = GetLiveSessionParams.safeParse({ sessionId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const session = liveSessions.get(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const durationSecs = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
  res.json({ ...session, durationSecs });
});

router.delete("/live/session/:sessionId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = StopLiveSessionParams.safeParse({ sessionId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const session = liveSessions.get(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  session.isActive = false;
  const durationSecs = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
  const name = `Run on ${new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}`;

  const [activity] = await db
    .insert(activitiesTable)
    .values({
      name,
      date: session.startedAt.split("T")[0],
      distanceKm: session.distanceKm,
      durationSecs,
      elevationGainM: 0,
      avgPaceSecPerKm: session.distanceKm > 0 ? Math.round(durationSecs / session.distanceKm) : 0,
      type: "run",
      points: session.points,
    })
    .returning();

  liveSessions.delete(params.data.sessionId);
  res.json(activity);
});

router.post("/live/session/:sessionId/point", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = AddLivePointParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddLivePointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const session = liveSessions.get(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const point: TrackPoint = {
    lat: parsed.data.lat,
    lon: parsed.data.lon,
    ele: parsed.data.ele,
    time: parsed.data.time ?? new Date().toISOString(),
  };

  if (session.points.length > 0) {
    const prev = session.points[session.points.length - 1];
    session.distanceKm += haversineKm(prev, point);
  }

  session.points.push(point);

  const durationSecs = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
  session.durationSecs = durationSecs;
  session.currentPaceSecPerKm = session.distanceKm > 0 ? Math.round(durationSecs / session.distanceKm) : 0;

  res.json({ ...session, durationSecs });
});

export default router;
