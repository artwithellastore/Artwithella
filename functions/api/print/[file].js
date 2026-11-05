// GET /api/print/<piece id>.jpg?exp=...&sig=...
// Serves the private full-resolution file from R2 to Lumaprints, only with a valid signed, unexpired link.
import { CATALOG } from "../../_lib/catalog.js";
import { hmacHex, safeEqual } from "../../_lib/stripe.js";

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (!env.PRINTS || !env.PRINT_LINK_SECRET) return new Response("Not configured", { status: 404 });

  const id = String(params.file || "").replace(/\.jpg$/, "");
  if (!CATALOG.pieces.some((p) => p.id === id)) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  if (!exp || exp < Date.now() / 1000) return new Response("Link expired", { status: 403 });
  if (!safeEqual(sig, await hmacHex(env.PRINT_LINK_SECRET, `${id}.${exp}`))) return new Response("Forbidden", { status: 403 });

  const obj = await env.PRINTS.get(id + ".jpg");
  if (!obj) return new Response("File missing", { status: 404 });
  return new Response(request.method === "HEAD" ? null : obj.body, {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(obj.size), "Cache-Control": "private, no-store" },
  });
}
