import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const storeCategoriesTable = pgTable("store_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  labelEn: text("label_en").notNull(),
  labelRu: text("label_ru").notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStoreCategorySchema = createInsertSchema(storeCategoriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStoreCategory = z.infer<typeof insertStoreCategorySchema>;
export type StoreCategory = typeof storeCategoriesTable.$inferSelect;
