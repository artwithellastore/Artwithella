// Shared catalog logic. Everything the customer can influence is re-validated
// here so prices and product IDs always come from catalog.json, never the browser.
import catalog from "../../catalog.json";

export const CATALOG = catalog;
export const MAX_LINES = 15;
export const MAX_QTY_PER_LINE = 20;
export const MAX_TOTAL_QTY = 30;

export const sizeKey = (s) => `${s.w}x${s.h}`;

// A type is for sale only once its Lumaprints IDs are filled in.
export function enabledChoices(type) {
  if (!type.variant) return [];
  return type.variant.choices.filter((c) => Array.isArray(c.optionIds));
}
export function typeEnabled(type) {
  if (type.subcategoryId == null) return false;
  return !type.variant || enabledChoices(type).length > 0;
}

// Accepts [{piece, type, size:"8x10", variant, qty}] from the browser.
// Returns {error} or {items} where every item is fully resolved from the catalog.
export function resolveCart(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Your order is empty." };
  if (raw.length > MAX_LINES) return { error: "Too many different items in one order." };
  const items = [];
  let totalQty = 0;
  for (const r of raw) {
    const piece = catalog.pieces.find((p) => p.id === r.piece);
    const type = catalog.types[r.type];
    if (!piece || !type || !typeEnabled(type)) return { error: "One of the items is no longer available." };
    const size = type.sizes.find((s) => sizeKey(s) === r.size);
    if (!size) return { error: "One of the sizes is no longer available." };
    let choice = null;
    if (type.variant) {
      choice = enabledChoices(type).find((c) => c.key === r.variant);
      if (!choice) return { error: "One of the frame choices is no longer available." };
    }
    const qty = Math.floor(Number(r.qty));
    if (!(qty >= 1 && qty <= MAX_QTY_PER_LINE)) return { error: "Invalid quantity." };
    totalQty += qty;
    items.push({ piece, typeKey: r.type, type, size, choice, qty, unitCents: Math.round(size.price * 100) });
  }
  if (totalQty > MAX_TOTAL_QTY) return { error: "That's a big order! Please email me for orders over " + MAX_TOTAL_QTY + " items." };
  return { items };
}

export function itemName(it) {
  const frame = it.choice ? `, ${it.choice.label} frame` : "";
  return `${it.piece.t} (${it.type.label}, ${it.size.w}×${it.size.h} in${frame})`;
}

// Flat-rate shipping: priciest product type sets the base, each extra item adds a little.
export function shippingCents(items) {
  const s = catalog.shipping;
  const base = Math.max(...items.map((it) => s.base[it.typeKey] ?? 0));
  const qty = items.reduce((n, it) => n + it.qty, 0);
  return Math.round((base + s.extraPerItem * (qty - 1)) * 100);
}

// Compact cart encoding that fits in Stripe metadata (500 chars per value).
export function encodeCart(items) {
  const lines = items.map((it) => [it.piece.id, it.typeKey, sizeKey(it.size), it.choice ? it.choice.key : "-", it.qty].join("|"));
  const chunks = [];
  let cur = "";
  for (const l of lines) {
    if (cur && (cur + ";" + l).length > 450) { chunks.push(cur); cur = l; }
    else cur = cur ? cur + ";" + l : l;
  }
  if (cur) chunks.push(cur);
  const meta = {};
  chunks.forEach((c, i) => (meta["cart_" + i] = c));
  return meta;
}
export function decodeCart(meta) {
  const parts = [];
  for (let i = 0; meta && meta["cart_" + i]; i++) parts.push(...meta["cart_" + i].split(";"));
  return parts.map((p) => {
    const [piece, type, size, variant, qty] = p.split("|");
    return { piece, type, size, variant: variant === "-" ? undefined : variant, qty: Number(qty) };
  });
}
