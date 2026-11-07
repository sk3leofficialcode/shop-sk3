import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { storeCategoriesTable } from "./categories";

export const storeProductsTable = pgTable("store_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => storeCategoriesTable.id, { onDelete: "restrict" }),
  titleEn: text("title_en").notNull(),
  titleRu: text("title_ru").notNull(),
  descriptionEn: text("description_en").notNull().default(""),
  descriptionRu: text("description_ru").notNull().default(""),
  priceStars: integer("price_stars").notNull(),
  mediaType: text("media_type").notNull(),
  mediaPath: text("media_path"),
  mediaContentType: text("media_content_type"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertStoreProductSchema = createInsertSchema(storeProductsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStoreProduct = z.infer<typeof insertStoreProductSchema>;
export type StoreProduct = typeof storeProductsTable.$inferSelect;
