import { Router, type IRouter } from "express";
import { db, stravaConnectionsTable, activitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? "";

function getRedirectBase(req: import("express").Request): string {
  // Use explicit override if set
  if (process.env.STRAVA_REDIRECT_BASE) return process.env.STRAVA_REDIRECT_BASE;
  // Prefer forwarded host (set by Replit proxy)
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  if (host) return `${proto}://${host}`;
  // Fallback to REPLIT_DEV_DOMAIN
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
router.get("/strava/status", async (_req, res): Promise<void> => {
  if (!CLIENT_ID) { res.json({ connected: false, configured: false }); return; }
  const [conn] = await db.select().from(stravaConnectionsTable).limit(1);
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
    await db.insert(stravaConnectionsTable).values({
      athleteId: data.athlete.id,
      athleteName,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    }).onConflictDoUpdate({
      target: stravaConnectionsTable.athleteId,
      set: { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at, athleteName },
    });
    res.json({ ok: true, athleteName });
  } catch (e) {
    console.error("Strava exchange error:", e);
    res.status(500).json({ error: "Exchange failed" });
  }
});

// ── POST /api/strava/sync ─────────────────────────────────────────────────────
router.post("/strava/sync", async (_req, res): Promise<void> => {
  const [conn] = await db.select().from(stravaConnectionsTable).limit(1);
  if (!conn) { res.status(401).json({ error: "Not connected to Strava" }); return; }
  try {
    const token = await ensureValidToken(conn);
    const afterTs = conn.lastSyncAt ? Math.floor(conn.lastSyncAt.getTime() / 1000) : 0;
    const activRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${afterTs}`,
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
      }).onConflictDoUpdate({
        target: activitiesTable.stravaId,
        set: { name: sa.name, distanceKm, durationSecs: sa.moving_time ?? 0 },
      });
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
router.delete("/strava/disconnect", async (_req, res): Promise<void> => {
  await db.delete(stravaConnectionsTable);
  res.json({ ok: true });
});

export default router;
