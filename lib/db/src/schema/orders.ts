import { pgTable, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storeProductsTable } from "./products";

export const storeOrdersTable = pgTable("store_orders", {
  invoicePayload: text("invoice_payload").primaryKey(),
  productId: uuid("product_id").references(() => storeProductsTable.id, {
    onDelete: "set null",
  }),
  buyerTelegramId: text("buyer_telegram_id"),
  priceStars: integer("price_stars").notNull(),
  status: text("status").notNull().default("pending"),
  telegramChargeId: text("telegram_charge_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});
