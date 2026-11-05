// GET /api/admin/luma-catalog?token=ADMIN_TOKEN[&category=102][&subcategory=102001]
// Helper for filling in catalog.json: lists Lumaprints categories, subcategories and option IDs.
// (One level per request keeps it under Cloudflare's subrequest limit.)
import { json } from "../../_lib/stripe.js";
import { lumaBase, lumaAuth } from "../../_lib/lumaprints.js";

async function luma(env, path) {
  const r = await fetch(lumaBase(env) + path, { headers: { Authorization: lumaAuth(env) } });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; } catch { return { status: r.status, data: text.slice(0, 500) }; }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.ADMIN_TOKEN || url.searchParams.get("token") !== env.ADMIN_TOKEN) return json({ error: "Not allowed" }, 403);
  if (!env.LUMA_API_KEY || !env.LUMA_API_SECRET) return json({ error: "Set LUMA_API_KEY and LUMA_API_SECRET first" }, 500);

  const cat = url.searchParams.get("category");
  const sub = url.searchParams.get("subcategory");
  if (sub) return json({ using: lumaBase(env), options: await luma(env, `/api/v1/products/subcategories/${encodeURIComponent(sub)}/options`) });
  if (cat) return json({ using: lumaBase(env), subcategories: await luma(env, `/api/v1/products/categories/${encodeURIComponent(cat)}/subcategories`) });
  return json({
    using: lumaBase(env),
    hint: "Add &category=<id> to list subcategories, then &subcategory=<id> to list options.",
    categories: await luma(env, "/api/v1/products/categories"),
    stores: await luma(env, "/api/v1/stores"), // path is a best guess; see Lumaprints docs "Get all stores"
  });
}
