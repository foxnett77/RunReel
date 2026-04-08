import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const stravaConnectionsTable = pgTable("strava_connections", {
  id: serial("id").primaryKey(),
  athleteId: integer("athlete_id").notNull().unique(),
  athleteName: text("athlete_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type StravaConnection = typeof stravaConnectionsTable.$inferSelect;
