// POST /api/checkout  -> creates a Stripe Checkout Session and returns its URL.
import { resolveCart, itemName, shippingCents, encodeCart, CATALOG } from "../_lib/catalog.js";
import { stripe, json } from "../_lib/stripe.js";

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Checkout isn't set up yet." }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().slice(0, 200);
  const notes = String(body.notes || "").trim().slice(0, 400);
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);

  const cart = resolveCart(body.items);
  if (cart.error) return json({ error: cart.error }, 400);
  const items = cart.items;

  const origin = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const ship = shippingCents(items);

  const params = {
    mode: "payment",
    customer_email: email,
    success_url: origin + "/?order=success#order",
    cancel_url: origin + "/?order=cancelled#order",
    shipping_address_collection: { allowed_countries: CATALOG.shipping.countries },
    phone_number_collection: { enabled: true },
    shipping_options: [{
      shipping_rate_data: { type: "fixed_amount", display_name: "Shipping", fixed_amount: { amount: ship, currency: "usd" } },
    }],
    line_items: items.map((it) => ({
      quantity: it.qty,
      price_data: { currency: "usd", unit_amount: it.unitCents, product_data: { name: itemName(it) } },
    })),
    metadata: { ...encodeCart(items), customer_name: name, notes },
    payment_intent_data: {
      description: "Art With Ella print order",
      metadata: { customer_name: name, notes },
    },
  };

  try {
    const session = await stripe(env, "POST", "/checkout/sessions", params);
    return json({ url: session.url });
  } catch (e) {
    console.error(e.message);
    return json({ error: "Couldn't start checkout. Please try again or email me." }, 502);
  }
}
