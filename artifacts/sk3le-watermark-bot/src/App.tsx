import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import {
  ArrowDownRight, ArrowUpRight, AudioLines, Check, CircleHelp,
  Image as ImageIcon, LockKeyhole, LogOut, Menu, PackagePlus, Pencil, Plus,
  ShieldCheck, Sparkles, Star, Trash2, Upload, Video, X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminProductsQueryKey, getGetAdminSessionQueryKey, getGetStoreQueryKey,
  useCreateAdminSession, useCreateCategory, useCreateInvoice, useCreateProduct,
  useDeleteAdminSession, useDeleteCategory, useDeleteProduct, useGetAdminProducts,
  useGetAdminSession, useGetBotStatus, useGetStore, useUpdateCategory,
  useUpdateProduct,
} from '@workspace/api-client-react';
import type { Category, Product, ProductInput, ProductMediaType, ProductUpdate } from '@workspace/api-client-react';
import samplePfp from '@assets/generated_images/sk3le-sample-pfp.png';

const queryClient = new QueryClient();

function Home() {
  const [language, setLanguage] = useState<'en' | 'ru'>('en');
  const [filter, setFilter] = useState('all');
  const [adminOpen, setAdminOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [loginPin, setLoginPin] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const qc = useQueryClient();
  const storeQuery = useGetStore();
  const store = storeQuery.data;
  const botQuery = useGetBotStatus();
  const sessionQuery = useGetAdminSession({ query: { enabled: adminOpen, queryKey: getGetAdminSessionQueryKey(), retry: false } });
  const admin = sessionQuery.data?.isAdmin === true;
  const adminProductsQuery = useGetAdminProducts({ query: { enabled: admin, queryKey: getGetAdminProductsQueryKey() } });
  const loginMutation = useCreateAdminSession();
  const logoutMutation = useDeleteAdminSession();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const invoice = useCreateInvoice();

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroVisible(false), 1650);
    return () => window.clearTimeout(timer);
  }, []);

  const t = (en: string, ru: string) => language === 'en' ? en : ru;
  const categories = useMemo(() => [...(store?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [store?.categories]);
  const products = (store?.products ?? []).filter((p) => filter === 'all' || p.categoryId === filter);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500); };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetStoreQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAdminProductsQueryKey() });
  };
  const beginCheckout = (product: Product) => {
    if (!store?.paymentsEnabled || !botQuery.data?.paymentsEnabled) {
      notify(t('Stars checkout is not available right now.', 'Оплата Stars сейчас недоступна.'));
      return;
    }
    invoice.mutate({ data: { productId: product.id } }, {
      onSuccess: (result) => {
        const tg = (window as Window & { Telegram?: { WebApp?: { openInvoice?: (url: string, cb?: (status: string) => void) => void } } }).Telegram?.WebApp;
        if (tg?.openInvoice) tg.openInvoice(result.invoiceUrl, (status) => notify(status === 'paid' ? t('Payment complete. Your download is on its way.', 'Оплата прошла. Файл уже отправляется.') : t('Checkout closed.', 'Оплата закрыта.')));
        else {
          notify(t('Invoice created. Open this shop inside Telegram to pay with Stars.', 'Счёт создан. Откройте магазин в Telegram для оплаты Stars.'));
          window.open(result.invoiceUrl, '_blank', 'noopener,noreferrer');
        }
      },
      onError: () => notify(t('Could not create an invoice. Try again.', 'Не удалось создать счёт. Попробуйте ещё раз.')),
    });
  };
  const openAdmin = () => {
    setAdminOpen(true);
    sessionQuery.refetch();
  };
  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    loginMutation.mutate({ data: { pin: loginPin, initData: (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData } }, {
      onSuccess: () => { setLoginPin(''); qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() }); },
      onError: () => notify(t('That PIN did not unlock the studio.', 'Неверный PIN-код.')),
    });
  };
  const startProduct = (product?: Product) => { setEditProduct(product ?? null); setProductFormOpen(true); };
  const saveCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const labelEn = String(fd.get('labelEn')).trim();
    const labelRu = String(fd.get('labelRu')).trim();
    if (editCategory) {
      updateCategory.mutate({ categoryId: editCategory.id, data: { labelEn, labelRu, sortOrder: Number(fd.get('sortOrder')) } }, { onSuccess: () => { setCategoryFormOpen(false); invalidate(); notify(t('Category updated.', 'Категория обновлена.')); } });
    } else {
      const slug = labelEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      createCategory.mutate({ data: { slug, labelEn, labelRu, sortOrder: categories.length + 1 } }, { onSuccess: () => { setCategoryFormOpen(false); invalidate(); notify(t('Category created.', 'Категория создана.')); } });
    }
  };
  const removeCategory = (category: Category) => {
    if (!window.confirm(t(`Delete “${category.labelEn}”?`, `Удалить «${category.labelRu}»?`))) return;
    deleteCategory.mutate({ categoryId: category.id }, { onSuccess: () => { invalidate(); if (filter === category.id) setFilter('all'); notify(t('Category deleted.', 'Категория удалена.')); }, onError: () => notify(t('This category may still contain products.', 'В категории ещё могут быть товары.')) });
  };
  const removeProduct = (product: Product) => {
    if (!window.confirm(t(`Delete “${product.titleEn}”?`, `Удалить «${product.titleRu}»?`))) return;
    deleteProduct.mutate({ productId: product.id }, { onSuccess: () => { invalidate(); notify(t('Product deleted.', 'Товар удалён.')); } });
  };
  const categoryLabel = (category?: Category) => category ? (language === 'en' ? category.labelEn : category.labelRu) : '';
  const adminProducts = adminProductsQuery.data ?? store?.products ?? [];

  return <main className="shop-shell">
    {introVisible && <div className="intro-screen" role="status" aria-label="Made By Sk3le" onClick={() => setIntroVisible(false)}><div className="intro-ring" /><div className="intro-wordmark">Made By <span>Sk3le</span></div><span className="intro-caption">{t('CREATOR ASSETS', 'АВТОРСКИЕ АССЕТЫ')} / 2026</span></div>}
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar">
       <a className="brand" href="/" aria-label="SK3LE home"><span className="brand-mark">S<span>.</span></span><span className="brand-copy">SK3LE<span>WATERMARK BOT</span></span></a>
      <nav className={`topnav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <a href="#catalog" onClick={() => setMenuOpen(false)}>{t('Catalog', 'Каталог')}</a>
        <a href="https://t.me/sk3legoon" target="_blank" rel="noreferrer">{t('Channel', 'Канал')} <ArrowUpRight size={13} /></a>
      </nav>
      <div className="top-actions">
        <div className="language-switch" aria-label={t('Language', 'Язык')}>
          <button className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')} data-testid="button-language-en">EN</button>
          <span />
          <button className={language === 'ru' ? 'selected' : ''} onClick={() => setLanguage('ru')} data-testid="button-language-ru">RU</button>
        </div>
        {admin && <button className="button-primary compact-button header-add-item" onClick={() => startProduct()}><PackagePlus size={15} />{t('Add Item', 'Добавить товар')}</button>}
        <button className="icon-button admin-trigger" aria-label={t('Open admin controls', 'Открыть панель администратора')} onClick={openAdmin} data-testid="button-admin"><LockKeyhole size={16} /></button>
        <button className="icon-button mobile-menu" aria-label={t('Toggle menu', 'Открыть меню')} onClick={() => setMenuOpen(!menuOpen)}><Menu size={19} /></button>
      </div>
    </header>

    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" />{t('INDEPENDENT CREATOR SHOP', 'АВТОРСКИЙ МАГАЗИН')}</div>
        <h1 id="hero-title">{t('Made By', 'Сделано')}<br /><span>Sk3le<span className="hero-period">.</span></span></h1>
        <p className="hero-intro">{t('Small details. Distinct presence.', 'Маленькие детали. Яркий стиль.')}<br />{t('Digital assets made to make your next edit feel yours.', 'Цифровые ассеты, чтобы каждый монтаж был по-настоящему вашим.')}</p>
        <div className="hero-links">
          <a href="#catalog" className="button-primary">{t('Explore the collection', 'Смотреть коллекцию')} <ArrowDownRight size={17} /></a>
          <a className="text-link" href="https://t.me/sk3legoon" target="_blank" rel="noreferrer">@sk3legoon <ArrowUpRight size={14} /></a>
        </div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
        <div className="art-core"><span className="core-glyph">S</span><span className="core-caption">SK3LE<br />STUDIO</span></div>
          <div className="float-label label-top"><Sparkles size={13} />{t('DIGITAL GOODS', 'ЦИФРОВЫЕ ТОВАРЫ')} <span>01 / 05</span></div>
          <div className="float-label label-bottom"><span className="live-dot" />{t('MADE TO DROP IN', 'ГОТОВО К ИСПОЛЬЗОВАНИЮ')} <ArrowUpRight size={12} /></div>
        <div className="art-slice slice-a" /><div className="art-slice slice-b" />
      </div>
      <div className="hero-index"><span>01</span><span className="index-rule" /><span>05</span></div>
    </section>

    <section className="catalog-section" id="catalog">
      <div className="section-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" />{t('THE DROP', 'КОЛЛЕКЦИЯ')}</div><h2>{t('Made for the', 'Для твоего')} <em>{t('next frame.', 'следующего кадра.')}</em></h2></div>
        <div className="catalog-note"><Sparkles className="note-mark" size={15} />{t('Digital files. Instant delivery.', 'Цифровые файлы. Мгновенная доставка.')}</div>
      </div>
      <div className="catalog-toolbar">
        <div className="filter-list" role="tablist" aria-label={t('Filter products', 'Фильтр товаров')}>
          <button className={filter === 'all' ? 'filter-active' : ''} onClick={() => setFilter('all')} data-testid="filter-all">{t('All', 'Все')}<sup>{store?.products.length ?? 0}</sup></button>
          {categories.map((category) => <button key={category.id} className={filter === category.id ? 'filter-active' : ''} onClick={() => setFilter(category.id)} data-testid={`filter-${category.slug}`}>{categoryLabel(category)}</button>)}
        </div>
        <span className="result-count">{String(products.length).padStart(2, '0')} {t('ITEMS', 'ТОВАРОВ')}</span>
      </div>
      {storeQuery.isLoading ? <div className="product-grid">{[0,1,2].map((item) => <div className="product-skeleton" key={item}><div /><span /><i /></div>)}</div> :
        storeQuery.isError ? <div className="catalog-state"><CircleHelp size={24} /><h3>{t('The shop is taking a breather.', 'Магазин сейчас недоступен.')}</h3><button className="button-outline" onClick={() => storeQuery.refetch()}>{t('Try again', 'Повторить')}</button></div> :
        products.length === 0 ? <div className="catalog-state empty-state"><PackagePlus size={26} /><h3>{t('Nothing in this drop. Yet.', 'В этой подборке пока пусто.')}</h3><p>{t('New pieces are added as they are made.', 'Новые работы появляются по мере готовности.')}</p></div> :
        <div className="product-grid">{products.map((product, index) => {
          const category = categories.find((item) => item.id === product.categoryId);
          return <ProductCard key={product.id} product={product} category={categoryLabel(category)} index={index} language={language} onBuy={() => beginCheckout(product)} buying={invoice.isPending} isAdmin={admin} onDelete={() => removeProduct(product)} />;
        })}</div>}
      <div className="catalog-footer"><span>{t('A SMALL SHOP FOR BIG IDEAS', 'НЕБОЛЬШОЙ МАГАЗИН БОЛЬШИХ ИДЕЙ')}</span><span>SK3LE / 2026</span></div>
    </section>

    <section className="closing-band"><div className="closing-star"><Sparkles size={17} /></div><div><span className="eyebrow">{t('NEED SOMETHING ELSE?', 'НУЖНО ЧТО-ТО ЕЩЁ?')}</span><h2>{t('Let’s make it', 'Давай сделаем это')} <em>{t('yours.', 'твоим.')}</em></h2></div><a href="https://t.me/sk3legoon" target="_blank" rel="noreferrer" className="button-outline">{t('Talk to Sk3le', 'Написать Sk3le')} <ArrowUpRight size={16} /></a></section>
    <footer className="footer"><a className="footer-signature" href="https://t.me/sk3legoon" target="_blank" rel="noreferrer">Made By Sk3le <ArrowUpRight size={13} /></a><span>{t('Creator assets, with character.', 'Авторские ассеты с характером.')}</span><a href="https://t.me/sk3legoon" target="_blank" rel="noreferrer">@sk3legoon</a></footer>

    {toast && <div role="status" className="toast-message"><Check size={16} />{toast}</div>}
    {adminOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminOpen(false); }}>
      <section className={`admin-modal ${admin ? 'admin-wide' : ''}`} role="dialog" aria-modal="true" aria-label="Admin studio">
        <button className="modal-close" onClick={() => setAdminOpen(false)} aria-label={t('Close', 'Закрыть')}><X size={18} /></button>
        {!admin ? <div className="login-panel">
           <div className="admin-emblem"><LockKeyhole size={20} /></div><div className="eyebrow"><span className="eyebrow-line" />{t('PRIVATE STUDIO', 'ЗАКРЫТАЯ СТУДИЯ')}</div>
          <h2>{t('Owner access', 'Доступ владельца')}</h2><p>{t('This side of the shop is for Sk3le only.', 'Эта часть магазина доступна только Sk3le.')}</p>
           <form onSubmit={submitLogin}><label htmlFor="admin-pin">{t('ACCESS PIN', 'КОД ДОСТУПА')}</label><input id="admin-pin" type="password" autoComplete="current-password" value={loginPin} onChange={(e) => setLoginPin(e.target.value)} placeholder="••••••" data-testid="input-admin-pin" /><button className="button-primary full-button" disabled={loginMutation.isPending}>{loginMutation.isPending ? t('Checking…', 'Проверка…') : t('Unlock studio', 'Открыть панель')} <ArrowUpRight size={15} /></button></form>
          {sessionQuery.isError && <p className="hint-error">{t('Enter the owner PIN to continue.', 'Введите PIN владельца.')}</p>}
        </div> : <div className="studio">
          <div className="studio-head"><div><div className="eyebrow"><span className="eyebrow-line" />{t('SK3LE / CONTROL ROOM', 'SK3LE / ПАНЕЛЬ УПРАВЛЕНИЯ')}</div><h2>{t('Studio', 'Панель')}<span>.</span></h2></div><div className="studio-head-actions"><span className="session-pill"><ShieldCheck size={13} />{t('OWNER SESSION', 'СЕАНС ВЛАДЕЛЬЦА')}</span><button className="quiet-button" onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() }); } })}><LogOut size={14} />{t('Sign out', 'Выйти')}</button></div></div>
          <div className="studio-tabs"><span>{t('PRODUCTS', 'ТОВАРЫ')} <b>{adminProducts.length}</b></span><span>{t('CATEGORIES', 'КАТЕГОРИИ')} <b>{categories.length}</b></span><button onClick={() => startProduct()} className="button-primary compact-button"><Plus size={15} />{t('Add product', 'Добавить товар')}</button></div>
          <div className="admin-product-list">{adminProductsQuery.isLoading ? <div className="studio-loading">{t('Loading products…', 'Загрузка товаров…')}</div> : adminProductsQuery.isError ? <div className="studio-loading">{t('Could not load admin products.', 'Не удалось загрузить товары.')}</div> : adminProducts.map((product) => <div className="admin-product-row" key={product.id}><div className="admin-product-icon">{product.mediaType === 'video' ? <Video size={17} /> : product.mediaType === 'audio' ? <AudioLines size={17} /> : <ImageIcon size={17} />}</div><div className="admin-product-details"><strong>{language === 'en' ? product.titleEn : product.titleRu}</strong><span>{categoryLabel(categories.find((item) => item.id === product.categoryId))} · {product.priceStars} {t('STARS', 'ЗВЁЗД')}</span></div><button className="row-icon" onClick={() => startProduct(product)} aria-label={t('Edit product', 'Редактировать товар')}><Pencil size={15} /></button><button className="row-icon danger-icon" onClick={() => removeProduct(product)} aria-label={t('Delete product', 'Удалить товар')}><Trash2 size={15} /></button></div>)}</div>
           <div className="category-admin-head"><div><h3>{t('Categories', 'Категории')}</h3><p>{t('Edit or delete any section after its products are moved or removed.', 'Изменяйте и удаляйте разделы после переноса или удаления товаров.')}</p></div><button className="button-outline small-outline" onClick={() => { setEditCategory(null); setCategoryFormOpen(true); }}><Plus size={14} />{t('Add category', 'Добавить категорию')}</button></div>
           <div className="category-admin-list">{categories.map((category) => <div className="category-admin-row" key={category.id}><span>{language === 'en' ? category.labelEn : category.labelRu}<small>{language === 'en' ? category.labelRu : category.labelEn}</small></span><span className="category-sort">{category.isSystem ? t('SYSTEM', 'СИСТЕМНАЯ') : `#${category.sortOrder}`}</span><button className="row-icon" onClick={() => { setEditCategory(category); setCategoryFormOpen(true); }} aria-label={t('Edit category', 'Редактировать категорию')}><Pencil size={14} /></button><button className="row-icon danger-icon" onClick={() => removeCategory(category)} aria-label={t('Delete category', 'Удалить категорию')}><Trash2 size={14} /></button></div>)}</div>
        </div>}
      </section>
    </div>}
    {productFormOpen && <ProductEditor product={editProduct} categories={categories} language={language} busy={createProduct.isPending || updateProduct.isPending} onClose={() => setProductFormOpen(false)} onSave={async (data, file) => {
      try {
        let uploaded: { mediaPath: string; mediaUrl: string; mediaContentType: string; fileName: string; mediaType: ProductMediaType } | undefined;
        if (file) {
          const formData = new FormData(); formData.append('file', file);
          const response = await fetch('/api/admin/media', { method: 'POST', body: formData, credentials: 'include' });
          if (!response.ok) throw new Error('Upload failed');
          uploaded = await response.json() as { mediaPath: string; mediaUrl: string; mediaContentType: string; fileName: string; mediaType: ProductMediaType };
        }
        if (uploaded) data = { ...data, mediaPath: uploaded.mediaPath, mediaContentType: uploaded.mediaContentType, fileName: uploaded.fileName, mediaType: uploaded.mediaType };
        if (editProduct) updateProduct.mutate({ productId: editProduct.id, data: data as ProductUpdate }, { onSuccess: () => { setProductFormOpen(false); invalidate(); notify(t('Product saved.', 'Товар сохранён.')); }, onError: () => notify(t('Could not save product.', 'Не удалось сохранить товар.')) });
        else createProduct.mutate({ data: data as ProductInput }, { onSuccess: () => { setProductFormOpen(false); invalidate(); notify(t('Product added to the shop.', 'Товар добавлен в магазин.')); }, onError: () => notify(t('Could not create product.', 'Не удалось добавить товар.')) });
      } catch { notify(t('Media upload failed. Check the file and try again.', 'Не удалось загрузить файл. Проверьте файл и попробуйте снова.')); }
    }} />}
    {categoryFormOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCategoryFormOpen(false); }}><section className="form-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setCategoryFormOpen(false)} aria-label={t('Close', 'Закрыть')}><X size={18} /></button><div className="eyebrow"><span className="eyebrow-line" />{t('STUDIO / CATEGORIES', 'СТУДИЯ / КАТЕГОРИИ')}</div><h2>{editCategory ? t('Edit category', 'Изменить категорию') : t('New category', 'Новая категория')}</h2><form onSubmit={saveCategory} className="editor-form"><label>{t('Name in English', 'Название на английском')}<input name="labelEn" required maxLength={64} defaultValue={editCategory?.labelEn} /></label><label>{t('Name in Russian', 'Название на русском')}<input name="labelRu" required maxLength={64} defaultValue={editCategory?.labelRu} /></label>{editCategory && <label>{t('Sort order', 'Порядок')}<input name="sortOrder" type="number" min="0" defaultValue={editCategory.sortOrder} /></label>}<button className="button-primary full-button" disabled={createCategory.isPending || updateCategory.isPending}>{t('Save category', 'Сохранить категорию')} <Check size={15} /></button></form></section></div>}
  </main>;
}

function ProductCard({ product, category, index, language, onBuy, buying, isAdmin, onDelete }: { product: Product; category: string; index: number; language: 'en' | 'ru'; onBuy: () => void; buying: boolean; isAdmin: boolean; onDelete: () => void }) {
  const title = language === 'en' ? product.titleEn : product.titleRu;
  const description = language === 'en' ? product.descriptionEn : product.descriptionRu;
  const typeLabel = product.mediaType === 'video'
    ? (language === 'en' ? 'VIDEO' : 'ВИДЕО')
    : product.mediaType === 'audio'
      ? (language === 'en' ? 'AUDIO' : 'АУДИО')
      : (language === 'en' ? 'IMAGE' : 'ИЗОБРАЖЕНИЕ');
  const media = product.mediaUrl || (product.mediaPath ? `/api${product.mediaPath}` : '');
  const visual = product.mediaType === 'image' && (media || product.id === 'c3e00000-0000-4000-8000-000000000104')
    ? <img className="product-media" src={media || samplePfp} alt={title} />
    : product.mediaType === 'video' && media
      ? <video className="product-media" src={media} muted controls playsInline preload="metadata" />
      : product.mediaType === 'audio' && media
        ? <div className="audio-preview"><AudioLines size={27} strokeWidth={1.3} /><audio src={media} controls preload="metadata" aria-label={title} /></div>
      : <div className={`product-art product-art-${index % 4}`}><span className="product-art-index">SK3LE / {String(index + 1).padStart(2, '0')}</span><div className="art-icon">{product.mediaType === 'audio' ? <AudioLines size={28} strokeWidth={1.3} /> : product.mediaType === 'video' ? <Video size={27} strokeWidth={1.3} /> : <ImageIcon size={26} strokeWidth={1.3} />}</div><span className="product-art-type">{typeLabel} / {language === 'en' ? 'ASSET' : 'АССЕТ'}</span></div>;
  return <article className="product-card" data-testid={`card-product-${product.id}`} style={{ animationDelay: `${index * 75}ms` }}>
    <div className="product-visual">{visual}{isAdmin && <button className="product-delete" onClick={onDelete} aria-label={language === 'en' ? `Delete ${title}` : `Удалить ${title}`}><Trash2 size={12} />{language === 'en' ? 'Delete' : 'Удалить'}</button>}<span className="product-type">{typeLabel}</span><span className="product-number">0{index + 1}</span></div>
    <div className="product-info"><div className="product-meta"><span>{category}</span><span className="meta-dot" /> <span>{product.fileName?.split('.').pop()?.toUpperCase() || typeLabel}</span></div><h3>{title}</h3><p>{description}</p><div className="product-buy-row"><button className="buy-button" onClick={onBuy} disabled={buying} data-testid={`button-buy-${product.id}`}><Star size={13} />{buying ? (language === 'en' ? 'Preparing…' : 'Подготовка…') : (language === 'en' ? 'Buy with Telegram Stars' : 'Оплатить Telegram Stars')}<ArrowUpRight size={15} /></button><span className="price"><Star className="star-symbol" size={12} fill="currentColor" />{product.priceStars}<small>{language === 'en' ? 'STARS' : 'ЗВЁЗД'}</small></span></div></div>
  </article>;
}

function ProductEditor({ product, categories, language, busy, onClose, onSave }: { product: Product | null; categories: Category[]; language: 'en' | 'ru'; busy: boolean; onClose: () => void; onSave: (data: ProductInput | ProductUpdate, file: File | null) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data: ProductInput | ProductUpdate = {
      categoryId: String(form.get('categoryId')),
      titleEn: String(form.get('titleEn')).trim(),
      titleRu: String(form.get('titleRu')).trim(),
      descriptionEn: String(form.get('descriptionEn')).trim(),
      descriptionRu: String(form.get('descriptionRu')).trim(),
      priceStars: Number(form.get('priceStars')),
      ...(product?.mediaPath ? {
        mediaType: product.mediaType,
        mediaPath: product.mediaPath,
        mediaContentType: product.mediaContentType ?? '',
        fileName: product.fileName ?? '',
      } : {}),
      ...(!product ? { mediaType: 'image' as const, mediaPath: '', mediaContentType: '', fileName: '' } : {}),
    };
    if (!product && !file) { setFileError(language === 'en' ? 'Choose the downloadable asset first.' : 'Сначала выберите файл для загрузки.'); return; }
    if (product && !file) onSave(data, null);
    else onSave(data, file);
  };
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="form-modal product-editor" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label={language === 'en' ? 'Close' : 'Закрыть'}><X size={18} /></button><div className="eyebrow"><span className="eyebrow-line" />{language === 'en' ? 'STUDIO / PRODUCTS' : 'СТУДИЯ / ТОВАРЫ'}</div><h2>{product ? (language === 'en' ? 'Edit asset' : 'Изменить товар') : (language === 'en' ? 'Add an asset' : 'Новый товар')}</h2>
    <form onSubmit={submit} className="editor-form">
      <div className="editor-two"><label>{language === 'en' ? 'English title' : 'Название на английском'}<input name="titleEn" required maxLength={120} defaultValue={product?.titleEn} /></label><label>{language === 'en' ? 'Russian title' : 'Название на русском'}<input name="titleRu" required maxLength={120} defaultValue={product?.titleRu} /></label></div>
      <div className="editor-two"><label>{language === 'en' ? 'Description / EN' : 'Описание / EN'}<textarea name="descriptionEn" maxLength={1200} rows={3} defaultValue={product?.descriptionEn} /></label><label>{language === 'en' ? 'Description / RU' : 'Описание / RU'}<textarea name="descriptionRu" maxLength={1200} rows={3} defaultValue={product?.descriptionRu} /></label></div>
      <div className="editor-two"><label>{language === 'en' ? 'Category' : 'Категория'}<select name="categoryId" required defaultValue={product?.categoryId || categories[0]?.id}>{categories.map((cat) => <option key={cat.id} value={cat.id}>{language === 'en' ? cat.labelEn : cat.labelRu}</option>)}</select></label><label>{language === 'en' ? 'Price in Stars' : 'Цена в Stars'}<input name="priceStars" type="number" required min="1" max="100000" defaultValue={product?.priceStars ?? 75} /></label></div>
     <label className="upload-zone"><input type="file" accept=".mp4,.mp3,.png,.jpg,.jpeg" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileError(''); }} /><span className="upload-icon"><Upload size={18} /></span><strong>{file ? file.name : (product ? (language === 'en' ? 'Replace downloadable file' : 'Заменить файл') : (language === 'en' ? 'Choose downloadable file' : 'Выбрать файл'))}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : (language === 'en' ? 'MP4, MP3, PNG, JPG OR JPEG · MAX 100 MB' : 'MP4, MP3, PNG, JPG ИЛИ JPEG · МАКСИМУМ 100 МБ')}</small></label>
      {fileError && <p className="hint-error">{fileError}</p>}<button className="button-primary full-button" disabled={busy}>{busy ? (language === 'en' ? 'Saving…' : 'Сохранение…') : (language === 'en' ? 'Save asset' : 'Сохранить товар')} <Check size={15} /></button>
    </form></section></div>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
