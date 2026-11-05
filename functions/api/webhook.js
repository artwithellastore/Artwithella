// POST /api/webhook  <- Stripe. After a paid checkout, place the order with Lumaprints.
import { resolveCart, itemName } from "../_lib/catalog.js";
import { decodeCart } from "../_lib/catalog.js";
import { stripe, verifyStripeSignature } from "../_lib/stripe.js";
import { buildOrder, submitOrder } from "../_lib/lumaprints.js";

const WANTED = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const valid = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response("Bad signature", { status: 400 });

  const event = JSON.parse(raw);
  if (!WANTED.includes(event.type)) return new Response("Ignored", { status: 200 });
  const session = event.data.object;
  if (session.payment_status !== "paid") return new Response("Waiting for payment", { status: 200 });
  if (!session.metadata || !session.metadata.cart_0) return new Response("Not a print order", { status: 200 });

  try {
    const result = await fulfil(env, session, new URL(request.url).origin);
    return new Response(result, { status: 200 });
  } catch (e) {
    console.error("Fulfilment failed for", session.id, e.message);
    await recordFailure(env, session, e.message);
    return new Response("Fulfilment failed; Stripe will retry", { status: 500 }); // Stripe retries with backoff
  }
}

export async function fulfil(env, session, origin) {
  const piId = session.payment_intent;
  const pi = await stripe(env, "GET", "/payment_intents/" + piId);
  if (pi.metadata && pi.metadata.luma_order) return "Already sent to Lumaprints"; // duplicate delivery

  const cart = resolveCart(decodeCart(session.metadata));
  if (cart.error) throw new Error("Cart could not be rebuilt: " + cart.error);

  const shipping = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details;
  if (!shipping || !shipping.address) throw new Error("No shipping address on the session");
  const phone = session.customer_details && session.customer_details.phone;

  const externalId = "AWE-" + session.id.slice(-12);
  const order = await buildOrder(env, origin, { externalId, items: cart.items, ship: shipping, phone });
  const res = await submitOrder(env, order);

  await stripe(env, "POST", "/payment_intents/" + piId, {
    metadata: { luma_order: String(res.orderNumber || "submitted"), luma_external_id: externalId, luma_error: "" },
  });
  return "Sent to Lumaprints: " + (res.orderNumber || "ok");
}

async function recordFailure(env, session, message) {
  try {
    await stripe(env, "POST", "/payment_intents/" + session.payment_intent, { metadata: { luma_error: message.slice(0, 450) } });
  } catch (e) { console.error(e.message); }
  if (env.RESEND_API_KEY && env.ALERT_EMAIL) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.ALERT_FROM || "Art With Ella <onboarding@resend.dev>",
          to: [env.ALERT_EMAIL],
          subject: "Paid order needs attention (Lumaprints failed)",
          text: `A customer paid but the order was NOT placed with Lumaprints.\n\nStripe session: ${session.id}\nPayment: ${session.payment_intent}\nCustomer: ${session.customer_details && session.customer_details.email}\n\nError: ${message}\n\nStripe will keep retrying automatically. If you fix the cause (e.g. a missing print file) it should go through on the next retry; you can also resend the event from Stripe Dashboard > Developers > Webhooks.`,
        }),
      });
    } catch (e) { console.error(e.message); }
  }
}
