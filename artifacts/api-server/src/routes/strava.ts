import { Router, type IRouter } from "express";
import { db, stravaConnectionsTable, activitiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

function deviceId(req: import("express").Request): string {
  return (req.headers["x-device-id"] as string) || "default";
}

const router: IRouter = Router();

const CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? "";

function getRedirectBase(_req: import("express").Request): string {
  // Explicit override wins
  if (process.env.STRAVA_REDIRECT_BASE) return process.env.STRAVA_REDIRECT_BASE;
  // Use the stable Replit dev domain — this is what must be registered on Strava.
  // We intentionally do NOT use x-forwarded-host here because the published domain
  // may differ from what the user registered on the Strava developer portal.
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:3001";
}

// ── Helper: refresh access token if expired ───────────────────────────────────
async function ensureValidToken(conn: typeof stravaConnectionsTable.$inferSelect) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (conn.expiresAt > nowSec + 60) return conn.accessToken;
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  const data = await res.json() as { access_token: string; refresh_token: string; expires_at: number };
  await db.update(stravaConnectionsTable)
    .set({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at })
    .where(eq(stravaConnectionsTable.id, conn.id));
  return data.access_token;
}

// ── Helper: map Strava sport type to our type ─────────────────────────────────
function mapType(stravaType: string): string {
  if (/run|jog|trail/i.test(stravaType)) return "run";
  if (/ride|bike|cycling|gravel/i.test(stravaType)) return "ride";
  if (/swim/i.test(stravaType)) return "swim";
  if (/walk|hike/i.test(stravaType)) return "walk";
  return "other";
}

// ── GET /api/strava/status ────────────────────────────────────────────────────
router.get("/strava/status", async (req, res): Promise<void> => {
  if (!CLIENT_ID) { res.json({ connected: false, configured: false }); return; }
  const [conn] = await db.select().from(stravaConnectionsTable)
    .where(eq(stravaConnectionsTable.deviceId, deviceId(req))).limit(1);
  if (!conn) { res.json({ connected: false, configured: true }); return; }
  res.json({
    connected: true,
    configured: true,
    athleteName: conn.athleteName,
    lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
  });
});

// ── GET /api/strava/connect ───────────────────────────────────────────────────
router.get("/strava/connect", (req, res): void => {
  if (!CLIENT_ID) { res.status(503).json({ error: "STRAVA_CLIENT_ID not configured" }); return; }
  // Callback goes to the FRONTEND route /strava/callback (no /api prefix)
  // so the registered domain on Strava is just the main app domain
  const redirectUri = `${getRedirectBase(req)}/strava/callback`;
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,activity:read_all");
  res.redirect(url.toString());
});

// ── POST /api/strava/exchange — called by frontend after receiving OAuth code ─
router.post("/strava/exchange", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: "Missing code" }); return; }
  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Strava token exchange error:", errText);
      throw new Error("Token exchange failed");
    }
    const data = await tokenRes.json() as {
      access_token: string; refresh_token: string; expires_at: number;
      athlete: { id: number; firstname: string; lastname: string };
    };
    const athleteName = `${data.athlete.firstname} ${data.athlete.lastname}`.trim();
    const did = deviceId(req);
    await db.insert(stravaConnectionsTable).values({
      athleteId: data.athlete.id,
      athleteName,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      deviceId: did,
    }).onConflictDoUpdate({
      target: stravaConnectionsTable.athleteId,
      set: { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at, athleteName, deviceId: did },
    });
    res.json({ ok: true, athleteName });
  } catch (e) {
    console.error("Strava exchange error:", e);
    res.status(500).json({ error: "Exchange failed" });
  }
});

// ── POST /api/strava/sync ─────────────────────────────────────────────────────
router.post("/strava/sync", async (req, res): Promise<void> => {
  const did = deviceId(req);
  const [conn] = await db.select().from(stravaConnectionsTable)
    .where(eq(stravaConnectionsTable.deviceId, did)).limit(1);
  if (!conn) { res.status(401).json({ error: "Not connected to Strava" }); return; }
  try {
    const token = await ensureValidToken(conn);
    // Always start from Jan 1 of the current year
    const currentYearStart = Math.floor(new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`).getTime() / 1000);
    const afterTs = conn.lastSyncAt
      ? Math.max(Math.floor(conn.lastSyncAt.getTime() / 1000), currentYearStart)
      : currentYearStart;
    const activRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=100&after=${afterTs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!activRes.ok) throw new Error("Failed to fetch activities");
    const stravaActivities = await activRes.json() as Array<{
      id: number; name: string; type: string; sport_type: string;
      start_date_local: string; distance: number; moving_time: number;
      total_elevation_gain: number; average_speed: number; max_speed: number;
      map?: { summary_polyline?: string };
    }>;

    let imported = 0;
    for (const sa of stravaActivities) {
      const avgSpeedMps = sa.average_speed ?? 0;
      const avgPaceSecPerKm = avgSpeedMps > 0 ? Math.round(1000 / avgSpeedMps) : null;
      const distanceKm = (sa.distance ?? 0) / 1000;

      // Fetch GPS stream for this activity
      let points: Array<{ lat: number; lon: number; ele?: number }> = [];
      try {
        const streamRes = await fetch(
          `https://www.strava.com/api/v3/activities/${sa.id}/streams?keys=latlng,altitude&key_by_type=true`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (streamRes.ok) {
          const streams = await streamRes.json() as {
            latlng?: { data: [number, number][] };
            altitude?: { data: number[] };
          };
          const latlng = streams.latlng?.data ?? [];
          const alt = streams.altitude?.data ?? [];
          points = latlng.map(([lat, lon], i) => ({ lat, lon, ele: alt[i] }));
        }
      } catch { /* stream not available */ }

      // Upsert: check if this strava activity already exists for this device
      const [existing] = await db.select({ id: activitiesTable.id })
        .from(activitiesTable)
        .where(and(eq(activitiesTable.stravaId, sa.id), eq(activitiesTable.deviceId, did)));

      if (existing) {
        await db.update(activitiesTable)
          .set({ name: sa.name, distanceKm, durationSecs: sa.moving_time ?? 0, points })
          .where(eq(activitiesTable.id, existing.id));
      } else {
        await db.insert(activitiesTable).values({
          name: sa.name,
          date: sa.start_date_local.slice(0, 10),
          distanceKm,
          durationSecs: sa.moving_time ?? 0,
          elevationGainM: sa.total_elevation_gain ?? null,
          avgPaceSecPerKm,
          maxSpeedKmh: sa.max_speed ? sa.max_speed * 3.6 : null,
          type: mapType(sa.sport_type ?? sa.type),
          points,
          stravaId: sa.id,
          deviceId: did,
        });
      }
      imported++;
    }

    await db.update(stravaConnectionsTable)
      .set({ lastSyncAt: new Date() })
      .where(eq(stravaConnectionsTable.id, conn.id));

    res.json({ imported, total: stravaActivities.length });
  } catch (e) {
    console.error("Strava sync error:", e);
    res.status(500).json({ error: String(e) });
  }
});

// ── DELETE /api/strava/disconnect ─────────────────────────────────────────────
router.delete("/strava/disconnect", async (req, res): Promise<void> => {
  await db.delete(stravaConnectionsTable)
    .where(eq(stravaConnectionsTable.deviceId, deviceId(req)));
  res.json({ ok: true });
});

export default router;
