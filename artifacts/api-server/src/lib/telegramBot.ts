import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Markup, Telegraf } from "telegraf";
import { db, appSettingsTable, storeOrdersTable, storeProductsTable } from "@workspace/db";
import { logger } from "./logger";

let bot: Telegraf | null = null;
let startPromise: Promise<void> | null = null;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.BOT_TOKEN);
}

export function isTelegramReady(): boolean {
  return isTelegramConfigured() && bot !== null;
}

function miniAppUrl(): string | null {
  const configured = process.env.MINI_APP_URL?.trim();
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const candidate = configured || domain;
  if (!candidate) return null;
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function createStarsInvoiceLink(product: {
  id: string;
  titleEn: string;
  descriptionEn: string;
  priceStars: number;
}): Promise<string | null> {
  if (!bot || !isTelegramConfigured()) return null;

  const payload = `sk3le_${randomUUID()}`;
  await db.insert(storeOrdersTable).values({
    invoicePayload: payload,
    productId: product.id,
    priceStars: product.priceStars,
    status: "pending",
  });

  try {
    return await bot.telegram.createInvoiceLink({
      title: product.titleEn.slice(0, 32),
      description: (product.descriptionEn || product.titleEn).slice(0, 255),
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: product.titleEn.slice(0, 32), amount: product.priceStars }],
    });
  } catch (error) {
    await db
      .update(storeOrdersTable)
      .set({ status: "failed" })
      .where(eq(storeOrdersTable.invoicePayload, payload));
    throw error;
  }
}

async function saveOwnerChatId(chatId: number): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key: "owner_chat_id", value: String(chatId) })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: String(chatId), updatedAt: new Date() },
    });
}

async function notifyOwner(message: string): Promise<void> {
  if (!bot) return;
  const [setting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "owner_chat_id"))
    .limit(1);
  if (!setting) {
    logger.warn("Purchase completed, but the owner has not started the bot yet");
    return;
  }
  try {
    await bot.telegram.sendMessage(setting.value, message);
  } catch (error) {
    logger.error({ err: error }, "Could not send the owner purchase notification");
  }
}

export async function startTelegramBot(): Promise<void> {
  if (!process.env.BOT_TOKEN) {
    logger.info("Telegram bot is idle; add BOT_TOKEN to enable Stars checkout");
    return;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const instance = new Telegraf(process.env.BOT_TOKEN!);
    bot = instance;

    instance.start(async (ctx) => {
      if (ctx.from.username?.toLowerCase() === "sk3lefake") {
        await saveOwnerChatId(ctx.chat.id);
        await ctx.reply("Owner access is connected. Purchase alerts will be sent here.");
      }

      const url = miniAppUrl();
      if (url) {
        await ctx.reply(
          "Open the SK3LE WATERMARK BOT store to browse creator assets.",
          Markup.inlineKeyboard([Markup.button.webApp("Open the store", url)]),
        );
      } else {
        await ctx.reply(
          "Visit the SK3LE WATERMARK BOT store from its public link. Browse updates at https://t.me/sk3legoon",
        );
      }
    });

    instance.on("pre_checkout_query", async (ctx) => {
      const query = ctx.update.pre_checkout_query;
      const [order] = await db
        .select()
        .from(storeOrdersTable)
        .where(eq(storeOrdersTable.invoicePayload, query.invoice_payload))
        .limit(1);
      const valid =
        Boolean(order) &&
        order.status === "pending" &&
        Boolean(order.productId) &&
        order.priceStars === query.total_amount &&
        query.currency === "XTR";

      if (valid && order) {
        await db
          .update(storeOrdersTable)
          .set({ buyerTelegramId: String(query.from.id) })
          .where(eq(storeOrdersTable.invoicePayload, query.invoice_payload));
      }
      await ctx.answerPreCheckoutQuery(
        valid,
        valid ? undefined : "This invoice is no longer valid. Please create a new one.",
      );
    });

    instance.on("message", async (ctx) => {
      if (!("successful_payment" in ctx.message)) return;
      const payment = ctx.message.successful_payment;
      const [order] = await db
        .select()
        .from(storeOrdersTable)
        .where(eq(storeOrdersTable.invoicePayload, payment.invoice_payload))
        .limit(1);
      if (!order || order.status === "paid") return;

      const [product] = order.productId
        ? await db
            .select()
            .from(storeProductsTable)
            .where(eq(storeProductsTable.id, order.productId))
            .limit(1)
        : [];

      const [updated] = await db
        .update(storeOrdersTable)
        .set({
          status: "paid",
          buyerTelegramId: String(ctx.from.id),
          telegramChargeId: payment.telegram_payment_charge_id,
          paidAt: new Date(),
        })
        .where(eq(storeOrdersTable.invoicePayload, payment.invoice_payload))
        .returning();
      if (!updated) return;

      const productTitle = product?.titleEn ?? "Store item";
      const appUrl = miniAppUrl();
      const fileUrl =
        product?.mediaPath && appUrl
          ? new URL(`/api/storage/objects/${product.mediaPath.replace(/^\/objects\//, "")}`, appUrl).toString()
          : null;
      await ctx.reply(
        fileUrl
          ? `Payment received for ${productTitle}. Your file: ${fileUrl}`
          : `Payment received for ${productTitle}. Open the store to access your file.`,
      );

      await notifyOwner(
        `Telegram Stars payment received\nItem: ${productTitle}\nAmount: ${payment.total_amount} Stars\nBuyer Telegram ID: ${ctx.from.id}`,
      );
    });

    instance.catch((error) => {
      logger.error({ err: error }, "Telegram bot update failed");
    });

    await instance.launch();
    logger.info("Telegram bot started with long polling");
    process.once("SIGINT", () => instance.stop("SIGINT"));
    process.once("SIGTERM", () => instance.stop("SIGTERM"));
  })().catch((error: unknown) => {
    bot = null;
    startPromise = null;
    logger.error({ err: error }, "Telegram bot could not start");
    throw error;
  });

  return startPromise;
}
