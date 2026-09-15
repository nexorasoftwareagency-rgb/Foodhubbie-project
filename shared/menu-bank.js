/**
 * SHARED MENU BANK — platform-wide library of menu categories + dishes.
 *
 * Every time an outlet adds or edits a category/dish (Admin catalog UI) or
 * onboarding seeds a template, a copy is mirrored here (write-through). Any
 * restaurant admin can then browse the bank (search / filter by category),
 * select items into a cart, and press "Get Menu" to copy them into their own
 * outlet where they become normal editable dishes.
 *
 * Bank shape:
 *   menuBank/categories/{slug(name-outletId)} → { name, image, addons, order, sourceBid, sourceOid, updatedAt }
 *   menuBank/dishes/{slug(name-category-outletId)} → { name, category, price, image, sizes, addons, stock, order, sourceBid, sourceOid, updatedAt }
 *
 * Keys include sourceOid to prevent collisions when multiple outlets have
 * the same dish/category name. Each outlet's entry is uniquely addressable.
 * The "Get Menu" flow reads all entries and dedupes by name+category for display.
 */

const SLUG_MAX = 80;

export function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  return s || 'item';
}

/**
 * Mirror a category/dish into the bank. `type` is 'categories' | 'dishes'.
 * `data` is the plain dish/category object the outlet just wrote.
 * `source` = { bid, oid }. Writes with the caller's auth; rules gate that
 * the caller is an admin of source.oid (or a super).
 * 
 * Slug includes sourceOid to prevent collisions when multiple outlets have
 * the same dish/category name. Each outlet's entry is uniquely addressable.
 */
export function mirrorToMenuBank(db, ref, set, type, data, source) {
  const key = type === 'categories'
    ? slugify(`${data.name}-${source.oid}`)
    : slugify(`${data.name}-${data.category || 'other'}-${source.oid}`);
  const entry = {
    ...data,
    sourceBid: source.bid,
    sourceOid: source.oid,
    updatedAt: Date.now(),
  };
  return set(ref(db, `menuBank/${type}/${key}`), entry);
}