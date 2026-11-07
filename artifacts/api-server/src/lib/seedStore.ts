import { eq } from "drizzle-orm";
import { db, appSettingsTable, storeCategoriesTable, storeProductsTable } from "@workspace/db";

const defaultCategories = [
  { id: "c3e00000-0000-4000-8000-000000000001", slug: "3d-watermarks", labelEn: "3D Watermarks", labelRu: "3D-водяные знаки", sortOrder: 10 },
  { id: "c3e00000-0000-4000-8000-000000000002", slug: "voiceovers", labelEn: "Voiceovers", labelRu: "Озвучка", sortOrder: 20 },
  { id: "c3e00000-0000-4000-8000-000000000003", slug: "edit-audios", labelEn: "Edit Audios", labelRu: "Аудио для эдитов", sortOrder: 30 },
  { id: "c3e00000-0000-4000-8000-000000000004", slug: "pfps", labelEn: "PFPs", labelRu: "Аватарки", sortOrder: 40 },
];

export async function ensureDefaultStoreContent(): Promise<void> {
  const [marker] = await db
    .select({ key: appSettingsTable.key })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "default_catalog_seeded"))
    .limit(1);
  if (marker) return;

  await db.transaction(async (tx) => {
    await tx
      .insert(storeCategoriesTable)
      .values(defaultCategories.map((category) => ({ ...category, isSystem: true })))
      .onConflictDoNothing();

    const categories = await tx.select().from(storeCategoriesTable);
    const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));
    const products = [
      {
        id: "c3e00000-0000-4000-8000-000000000101",
        categorySlug: "3d-watermarks",
        titleEn: "Neon Liquid Tag",
        titleRu: "Неоновый жидкий тег",
        descriptionEn: "A sample 3D watermark listing. Upload your own MP4 preview in admin.",
        descriptionRu: "Пример 3D-водяного знака. Загрузите свой MP4-превью в панели администратора.",
        priceStars: 15,
        mediaType: "video",
      },
      {
        id: "c3e00000-0000-4000-8000-000000000102",
        categorySlug: "voiceovers",
        titleEn: "Soft Voice Intro",
        titleRu: "Мягкое голосовое интро",
        descriptionEn: "A sample voiceover listing. Upload your own MP3 preview in admin.",
        descriptionRu: "Пример озвучки. Загрузите свой MP3-превью в панели администратора.",
        priceStars: 12,
        mediaType: "audio",
      },
      {
        id: "c3e00000-0000-4000-8000-000000000103",
        categorySlug: "edit-audios",
        titleEn: "Night Drive Loop",
        titleRu: "Ночной драйв",
        descriptionEn: "A sample edit-audio listing. Upload your own MP3 preview in admin.",
        descriptionRu: "Пример аудио для эдита. Загрузите свой MP3-превью в панели администратора.",
        priceStars: 20,
        mediaType: "audio",
      },
      {
        id: "c3e00000-0000-4000-8000-000000000104",
        categorySlug: "pfps",
        titleEn: "Violet Mask",
        titleRu: "Фиолетовая маска",
        descriptionEn: "A sample profile-picture listing. Upload your own image preview in admin.",
        descriptionRu: "Пример аватарки. Загрузите своё изображение в панели администратора.",
        priceStars: 10,
        mediaType: "image",
      },
    ];

    await tx
      .insert(storeProductsTable)
      .values(
        products.flatMap(({ categorySlug, ...product }) => {
          const categoryId = categoryIds.get(categorySlug);
          return categoryId ? [{ ...product, categoryId }] : [];
        }),
      )
      .onConflictDoNothing();
    await tx
      .insert(appSettingsTable)
      .values({ key: "default_catalog_seeded", value: "true" })
      .onConflictDoNothing();
  });
}
