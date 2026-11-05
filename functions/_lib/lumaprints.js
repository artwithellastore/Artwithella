import { hmacHex } from "./stripe.js";
import { sizeKey } from "./catalog.js";

export const lumaBase = (env) => (env.LUMA_API_BASE || "https://us.api-sandbox.lumaprints.com").replace(/\/$/, "");
export const lumaAuth = (env) => "Basic " + btoa(`${env.LUMA_API_KEY}:${env.LUMA_API_SECRET}`);

// Where Lumaprints downloads the full-resolution file from.
//  - R2 bucket bound as PRINTS (recommended): files stay private, we hand out signed, expiring links.
//  - Otherwise PRINT_FILE_BASE_URL + "/<piece id>.jpg" (any public host).
export async function printUrl(env, origin, pieceId) {
  if (env.PRINTS) {
    if (!env.PRINT_LINK_SECRET) throw new Error("PRINT_LINK_SECRET is not set");
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sig = await hmacHex(env.PRINT_LINK_SECRET, `${pieceId}.${exp}`);
    return `${origin}/api/print/${pieceId}.jpg?exp=${exp}&sig=${sig}`;
  }
  if (env.PRINT_FILE_BASE_URL) return `${env.PRINT_FILE_BASE_URL.replace(/\/$/, "")}/${pieceId}.jpg`;
  throw new Error("No print file source configured (bind an R2 bucket named PRINTS or set PRINT_FILE_BASE_URL)");
}

export function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "-", last: parts.slice(1).join(" ") || "-" };
}

// Builds the body for POST /api/v1/orders
export async function buildOrder(env, origin, { externalId, items, ship, phone }) {
  const { first, last } = splitName(ship.name);
  const a = ship.address || {};
  const orderItems = [];
  let n = 0;
  for (const it of items) {
    const lo = Math.min(it.size.w, it.size.h), hi = Math.max(it.size.w, it.size.h);
    orderItems.push({
      externalItemId: `${externalId}-${++n}`,
      subcategoryId: it.type.subcategoryId,
      quantity: it.qty,
      width: it.piece.land ? hi : lo,   // match the artwork's orientation
      height: it.piece.land ? lo : hi,
      file: { imageUrl: await printUrl(env, origin, it.piece.id) },
      orderItemOptions: [...(it.type.orderItemOptions || []), ...(it.choice ? it.choice.optionIds : [])],
      solidColorHexCode: null,
    });
  }
  return {
    externalId,
    storeId: Number(env.LUMA_STORE_ID),
    shippingMethod: "default",
    productionTime: "regular",
    recipient: {
      firstName: first,
      lastName: last,
      addressLine1: a.line1 || "",
      addressLine2: a.line2 || "",
      city: a.city || "",
      state: a.state || "",
      zipCode: a.postal_code || "",
      country: a.country || "US",
      phone: phone || "",
      company: "",
    },
    orderItems,
  };
}

export async function submitOrder(env, order) {
  const res = await fetch(lumaBase(env) + "/api/v1/orders", {
    method: "POST",
    headers: { Authorization: lumaAuth(env), "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const text = await res.text();
  if (res.status !== 201 && res.status !== 200) throw new Error(`Lumaprints ${res.status}: ${text.slice(0, 400)}`);
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return data; // { message, orderNumber }
}
