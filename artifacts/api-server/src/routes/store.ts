import { asc, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateAdminSessionBody,
  CreateAdminSessionResponse,
  CreateCategoryBody,
  CreateCategoryResponse,
  CreateInvoiceBody,
  CreateInvoiceResponse,
  CreateProductBody,
  CreateProductResponse,
  DeleteAdminSessionResponse,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  DeleteProductParams,
  DeleteProductResponse,
  GetAdminProductsResponse,
  GetAdminSessionResponse,
  GetBotStatusResponse,
  GetStoreResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import {
  db,
  storeCategoriesTable,
  storeProductsTable,
} from "@workspace/db";
import {
  clearAdminSession,
  isAdminSession,
  setAdminSession,
  verifyAdminPin,
  verifyTelegramOwner,
} from "../lib/adminAuth";
import { deleteStoredMedia, getMediaUrl } from "../lib/mediaStorage";
import { createStarsInvoiceLink, isTelegramConfigured, isTelegramReady } from "../lib/telegramBot";

const router: IRouter = Router();
const OWNER_LINK = "https://t.me/sk3legoon";
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const mediaPattern = /^\/objects\/uploads\/[a-f0-9-]+\.(?:mp4|mp3|png|jpg|jpeg)$/i;

function requireAdmin(req: Request, res: Response): boolean {
  if (isAdminSession(req)) return true;
  res.status(401).json({ error: "Admin authentication required" });
  return false;
}

function sessionBody(isAdmin: boolean) {
  return GetAdminSessionResponse.parse({
    isAdmin,
    ownerUsername: "sk3lefake",
  });
}

function publicProduct(product: typeof storeProductsTable.$inferSelect) {
  return {
    ...product,
    mediaUrl: product.mediaPath ? getMediaUrl(product.mediaPath) : null,
  };
}

function loginKey(req: Request): string {
  return req.ip || "unknown";
}

function loginAllowed(req: Request): boolean {
  const attempt = loginFailures.get(loginKey(req));
  if (!attempt || attempt.resetAt <= Date.now()) return true;
  return attempt.count < 5;
}

function recordLoginFailure(req: Request): void {
  const key = loginKey(req);
  const attempt = loginFailures.get(key);
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginFailures.set(key, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    return;
  }
  attempt.count += 1;
}

function validMedia(
  mediaType: "video" | "audio" | "image",
  mediaPath: string,
  contentType: string,
): boolean {
  if (!mediaPattern.test(mediaPath)) return false;
  const extension = mediaPath.toLowerCase().split(".").pop();
  if (mediaType === "video") return extension === "mp4" && contentType === "video/mp4";
  if (mediaType === "audio") {
    return extension === "mp3" && ["audio/mpeg", "audio/mp3"].includes(contentType);
  }
  return (
    ["png", "jpg", "jpeg"].includes(extension ?? "") &&
    ["image/png", "image/jpeg"].includes(contentType)
  );
}

router.get("/store", async (_req: Request, res: Response): Promise<void> => {
  const [categories, products] = await Promise.all([
    db.select().from(storeCategoriesTable).orderBy(asc(storeCategoriesTable.sortOrder)),
    db.select().from(storeProductsTable).orderBy(desc(storeProductsTable.createdAt)),
  ]);
  res.json(
    GetStoreResponse.parse({
      categories,
      products: products.map(publicProduct),
      paymentsEnabled: isTelegramReady(),
    }),
  );
});

router.get("/bot/status", (_req: Request, res: Response): void => {
  res.json(
    GetBotStatusResponse.parse({
      botConfigured: isTelegramConfigured(),
      paymentsEnabled: isTelegramReady(),
      ownerLink: OWNER_LINK,
    }),
  );
});

router.get("/admin/session", (req: Request, res: Response): void => {
  res.json(sessionBody(isAdminSession(req)));
});

router.post("/admin/session", (req: Request, res: Response): void => {
  const parsed = CreateAdminSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your admin PIN or open the store inside Telegram" });
    return;
  }
  if (!loginAllowed(req)) {
    res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
    return;
  }

  const pinAccepted = Boolean(parsed.data.pin && verifyAdminPin(parsed.data.pin));
  const telegramAccepted = Boolean(
    parsed.data.initData && verifyTelegramOwner(parsed.data.initData),
  );
  if (!pinAccepted && !telegramAccepted) {
    recordLoginFailure(req);
    res.status(401).json({ error: "That PIN or Telegram account is not authorized" });
    return;
  }

  loginFailures.delete(loginKey(req));
  setAdminSession(req, res);
  res.json(CreateAdminSessionResponse.parse(sessionBody(true)));
});

router.delete("/admin/session", (req: Request, res: Response): void => {
  clearAdminSession(req, res);
  res.status(204).json(DeleteAdminSessionResponse.parse(undefined));
});

router.post("/admin/categories", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slug = parsed.data.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    res.status(400).json({ error: "Category IDs can use lowercase letters, numbers, and hyphens" });
    return;
  }

  const [category] = await db
    .insert(storeCategoriesTable)
    .values({
      slug,
      labelEn: parsed.data.labelEn.trim(),
      labelRu: parsed.data.labelRu.trim(),
      sortOrder: parsed.data.sortOrder ?? 100,
      isSystem: false,
    })
    .onConflictDoNothing({ target: storeCategoriesTable.slug })
    .returning();
  if (!category) {
    res.status(409).json({ error: "A category with that ID already exists" });
    return;
  }
  res.status(201).json(CreateCategoryResponse.parse(category));
});

router.patch(
  "/admin/categories/:categoryId",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const params = UpdateCategoryParams.safeParse(req.params);
    const parsed = UpdateCategoryBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid category update" });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Make at least one change" });
      return;
    }
    const update = {
      ...(parsed.data.labelEn !== undefined && { labelEn: parsed.data.labelEn.trim() }),
      ...(parsed.data.labelRu !== undefined && { labelRu: parsed.data.labelRu.trim() }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
    };
    const [category] = await db
      .update(storeCategoriesTable)
      .set(update)
      .where(eq(storeCategoriesTable.id, params.data.categoryId))
      .returning();
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.json(UpdateCategoryResponse.parse(category));
  },
);

router.delete(
  "/admin/categories/:categoryId",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const params = DeleteCategoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid category ID" });
      return;
    }
    const [category] = await db
      .select()
      .from(storeCategoriesTable)
      .where(eq(storeCategoriesTable.id, params.data.categoryId))
      .limit(1);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const [productCount] = await db
      .select({ value: count() })
      .from(storeProductsTable)
      .where(eq(storeProductsTable.categoryId, category.id));
    if (productCount.value > 0) {
      res.status(400).json({ error: "Delete or move this category's products first" });
      return;
    }
    await db.delete(storeCategoriesTable).where(eq(storeCategoriesTable.id, category.id));
    res.status(204).json(DeleteCategoryResponse.parse(undefined));
  },
);

router.get("/admin/products", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const products = await db
    .select()
    .from(storeProductsTable)
    .orderBy(desc(storeProductsTable.createdAt));
  res.json(GetAdminProductsResponse.parse(products.map(publicProduct)));
});

router.post("/admin/products", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [category] = await db
    .select({ id: storeCategoriesTable.id })
    .from(storeCategoriesTable)
    .where(eq(storeCategoriesTable.id, parsed.data.categoryId))
    .limit(1);
  if (!category) {
    res.status(400).json({ error: "Choose an existing category" });
    return;
  }
  if (!validMedia(parsed.data.mediaType, parsed.data.mediaPath, parsed.data.mediaContentType)) {
    res.status(400).json({ error: "Media type, file path, and file type must match" });
    return;
  }

  const [product] = await db
    .insert(storeProductsTable)
    .values({
      ...parsed.data,
      titleEn: parsed.data.titleEn.trim(),
      titleRu: parsed.data.titleRu.trim(),
      descriptionEn: parsed.data.descriptionEn.trim(),
      descriptionRu: parsed.data.descriptionRu.trim(),
      fileName: parsed.data.fileName.trim(),
    })
    .returning();
  res.status(201).json(CreateProductResponse.parse(publicProduct(product)));
});

router.patch(
  "/admin/products/:productId",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const params = UpdateProductParams.safeParse(req.params);
    const parsed = UpdateProductBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid product update" });
      return;
    }
    const [current] = await db
      .select()
      .from(storeProductsTable)
      .where(eq(storeProductsTable.id, params.data.productId))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Make at least one change" });
      return;
    }
    const categoryId = parsed.data.categoryId ?? current.categoryId;
    const [category] = await db
      .select({ id: storeCategoriesTable.id })
      .from(storeCategoriesTable)
      .where(eq(storeCategoriesTable.id, categoryId))
      .limit(1);
    if (!category) {
      res.status(400).json({ error: "Choose an existing category" });
      return;
    }
    const mediaPath =
      parsed.data.mediaPath === undefined ? current.mediaPath : parsed.data.mediaPath;
    const mediaType = parsed.data.mediaType ?? current.mediaType;
    const contentType =
      parsed.data.mediaContentType === undefined
        ? current.mediaContentType
        : parsed.data.mediaContentType;
    if (
      mediaPath &&
      (!contentType ||
        (mediaType !== "video" && mediaType !== "audio" && mediaType !== "image") ||
        !validMedia(mediaType, mediaPath, contentType))
    ) {
      res.status(400).json({ error: "Media type, file path, and file type must match" });
      return;
    }
    const update = {
      ...parsed.data,
      ...(parsed.data.titleEn !== undefined && { titleEn: parsed.data.titleEn.trim() }),
      ...(parsed.data.titleRu !== undefined && { titleRu: parsed.data.titleRu.trim() }),
      ...(parsed.data.descriptionEn !== undefined && {
        descriptionEn: parsed.data.descriptionEn.trim(),
      }),
      ...(parsed.data.descriptionRu !== undefined && {
        descriptionRu: parsed.data.descriptionRu.trim(),
      }),
      updatedAt: new Date(),
    };
    const [product] = await db
      .update(storeProductsTable)
      .set(update)
      .where(eq(storeProductsTable.id, current.id))
      .returning();
    res.json(UpdateProductResponse.parse(publicProduct(product)));
  },
);

router.delete(
  "/admin/products/:productId",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const params = DeleteProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid product ID" });
      return;
    }
    const [product] = await db
      .delete(storeProductsTable)
      .where(eq(storeProductsTable.id, params.data.productId))
      .returning();
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    if (product.mediaPath) {
      await deleteStoredMedia(product.mediaPath).catch((error: unknown) => {
        req.log.warn({ err: error, productId: product.id }, "Product removed but media cleanup failed");
      });
    }
    res.status(204).json(DeleteProductResponse.parse(undefined));
  },
);

router.post("/payments/invoice", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a product to buy" });
    return;
  }
  if (!isTelegramConfigured()) {
    res.status(503).json({ error: "Telegram Stars checkout is unavailable until BOT_TOKEN is added" });
    return;
  }
  const [product] = await db
    .select()
    .from(storeProductsTable)
    .where(eq(storeProductsTable.id, parsed.data.productId))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const invoiceUrl = await createStarsInvoiceLink(product);
  if (!invoiceUrl) {
    res.status(503).json({ error: "Telegram Stars checkout is not ready yet" });
    return;
  }
  res.json(CreateInvoiceResponse.parse({ invoiceUrl }));
});

export default router;
