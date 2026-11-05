# Art With Ella: Stripe + Lumaprints setup

**How it works:** customer picks a piece, type (art paper / canvas / framed) and size → pays on Stripe Checkout (which also collects their shipping address) → Stripe tells your Cloudflare site the payment succeeded → Cloudflare sends the order to Lumaprints, which prints and ships it. Prices are enforced on the server from `catalog.json`, so nobody can change a price in their browser.

```
index.html          your site (reads catalog.json)
catalog.json        pieces, print types, sizes, prices, shipping, Lumaprints IDs  <- the file you edit
functions/api/checkout.js      creates the Stripe Checkout page
functions/api/webhook.js       receives "paid" from Stripe, orders from Lumaprints
functions/api/print/[file].js  gives Lumaprints a private, expiring link to each full-res file
functions/api/admin/luma-catalog.js   helper to look up Lumaprints IDs
```

## 1. Accounts
- **Stripe**: finish activating the account. Start in **Test mode**.
- **Lumaprints**: create a Lumaprints account, **set a default billing address and payment method** (otherwise orders fail with "Default billing address not set"), then request **API access**. Use the **sandbox** keys first. Note your **store ID**.
- **Cloudflare**: free account.

## 2. Deploy to Cloudflare Pages
Pick one (a plain drag-and-drop upload may skip the `functions` folder, so avoid it):
- **GitHub (easiest long-term):** push this folder to a GitHub repo → Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo. Build command: *none*. Output directory: `/`.
- **Command line:** `npx wrangler pages deploy .` from this folder.

Then add your custom domain under the project's Custom domains tab.

## 3. Private print files (R2)
The images on the website are small 900px previews. Lumaprints needs **full-resolution files**.
1. Cloudflare dashboard → R2 → create a bucket named `art-with-ella-prints` (keep it **private**).
2. Upload each piece as a **JPG named after its id**: `kairos-sunset.jpg`, `little-eyes.jpg`, `world-outside.jpg`, `tea-time.jpg`, `hazel.jpg`, `sunset-florals.jpg`, `italian-streets.jpg`, `trickling-waters.jpg`, `petals-folds.jpg`, `ladybug.jpg`, `carl-smith-way.jpg`, `homer.jpg`, `snow-branches.jpg`.
3. Pages project → Settings → Bindings → add **R2 bucket**, variable name `PRINTS`, pick the bucket. (Or uncomment the block in `wrangler.toml`.)

Resolution: canvas needs about 200 DPI, so 16×20 → 3200×4000 px and 24×30 → 4800×6000 px. Use the largest scan/photo you have, with the same proportions as the website preview.

*(No R2? Skip it, host files anywhere public as `<id>.jpg`, and set `PRINT_FILE_BASE_URL` instead. Anyone could then download them, though.)*

## 4. Environment variables (Pages → Settings → Variables and Secrets; make the keys **Secrets**)
| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` now, `sk_live_...` later |
| `STRIPE_WEBHOOK_SECRET` | from step 5 |
| `LUMA_API_KEY`, `LUMA_API_SECRET` | Lumaprints API credentials |
| `LUMA_STORE_ID` | your Lumaprints store ID |
| `LUMA_API_BASE` | leave unset for sandbox (`https://us.api-sandbox.lumaprints.com`). For real orders, set the production URL from your Lumaprints API docs |
| `PRINT_LINK_SECRET` | any long random string |
| `ADMIN_TOKEN` | another long random string (for step 6; delete it afterwards) |
| `ALERT_EMAIL`, `RESEND_API_KEY` | *optional:* emails you if a paid order fails to reach Lumaprints (free Resend account; alerts go to the email you signed up with) |

## 5. Stripe webhook
Stripe → Developers → Webhooks → Add endpoint: `https://YOUR-DOMAIN/api/webhook`, events **`checkout.session.completed`** and **`checkout.session.async_payment_succeeded`**. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. Do this separately for Test and Live mode.

## 6. Fill in the Lumaprints IDs (needed for framed prints)
Only **Canvas** (subcategory 101001, 0.75in stretched canvas, confirmed in Lumaprints docs) and **Art paper** (103001) are pre-filled. **Please double-check 103001 is the paper you want.** Framed prints stay hidden on the site until you fill these in `catalog.json`, because I couldn't look up Lumaprints' catalog IDs without your API keys.

Visit these (replace values):
1. `https://YOUR-DOMAIN/api/admin/luma-catalog?token=ADMIN_TOKEN` → lists categories (and your store ID)
2. `...&category=<id>` → lists subcategories (copy the framed one's `subcategoryId` into `types.framed.subcategoryId`; same idea for choosing a different paper or canvas depth)
3. `...&subcategory=<id>` → lists option groups. For each frame color, put its `optionId`(s) in that choice's `optionIds`, e.g. `[12]`. Frame choices with `null` stay hidden. Make sure `size` limits match what each subcategory allows.

If you're unsure, leave `orderItemOptions` empty to use Lumaprints' defaults.

## 7. Test, then go live
1. Stripe test mode + Lumaprints sandbox: order something using card `4242 4242 4242 4242`, any future date/CVC.
2. Check Stripe → Payments: the payment gets a `luma_order` number in its metadata (or `luma_error` if something failed). Check the order in your Lumaprints sandbox account.
3. Test one of each: paper, canvas, framed, plus a landscape piece (A World Outside the Window, Italian Streets, Trickling Waters, Carl Smith Way), and check the crop looks right.
4. To go live: Stripe live keys + a new live webhook + its `whsec_`, Lumaprints production keys and `LUMA_API_BASE`, then place one small real order yourself.

## 8. Check your prices before launch
All prices and the flat shipping in `catalog.json` are **my placeholders for canvas/framed**; paper prices are yours. Compare each against what Lumaprints charges you (product cost + their shipping) plus Stripe's fee (2.9% + 30¢). Your $5 4×6 print, for example, probably loses money after the print cost and fee. Edit the numbers in `catalog.json` and redeploy.

## Adding a piece later
Add an entry to `pieces` in `catalog.json` (set `"land": true` if it's wider than tall), add its small preview image to `IMGS` in `index.html`, upload `<id>.jpg` to R2.

## If a paid order doesn't reach Lumaprints
The webhook returns an error, so Stripe retries automatically for up to ~3 days, and the reason is saved as `luma_error` on the payment. Fix the cause (missing print file, missing ID, billing issue) and it goes through on the next retry, or resend the event from Stripe → Developers → Webhooks.
