import { pgTable, serial, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  date: text("date").notNull(),
  distanceKm: real("distance_km").notNull().default(0),
  durationSecs: integer("duration_secs").notNull().default(0),
  elevationGainM: real("elevation_gain_m"),
  avgPaceSecPerKm: integer("avg_pace_sec_per_km"),
  maxSpeedKmh: real("max_speed_kmh"),
  type: text("type").notNull().default("run"),
  points: jsonb("points").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
