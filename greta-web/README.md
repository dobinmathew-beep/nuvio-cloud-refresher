# The Great Indian Addon

Vercel hosts the public website and standard Nuvio/Stremio catalog endpoints. GitHub independently refreshes the source data on `dobins-catalog`. The public site has no AI branding. The source stays in the separate `greta-site` branch, under `greta-web/`.

## Deploy

Import `dobinmathew-beep/nuvio-cloud-refresher` into Vercel, select `greta-site` as the production branch and `greta-web` as the root directory. Use the supplied `vercel.json` and Node 22. Build command: `node scripts/prepare.mjs`; output: `public`.

No runtime token is needed to read the public generated catalog snapshots. `PUBLIC_ORIGIN` is optional; otherwise the deployed request host is used. Catalog, artwork and manifest URLs returned to clients use that host. Existing legacy service URLs remain available independently.

Catalog selection uses an eight-bit hexadecimal mask, in order Malayalam movie/series, Tamil movie/series, Telugu movie/series, Hindi movie/series. `/install/ff/manifest.json` contains all eight; `/install/01/manifest.json` only Malayalam movies. A zero selection is rejected. The default manifest advertises catalog resources only, preserving AIOMetadata as the details provider. `/standalone/manifest.json` is optional fallback metadata mode.

## Support checkout

No payment processing is enabled by default. No card form, transaction capture or payment-success assertion exists on this site. Bank Muscat must approve the project-support purpose and enable the intended payment methods on the merchant account.

After the merchant provides a verified **public hosted checkout/payment link**, set the following as Vercel production environment values:

- `BANKMUSCAT_CHECKOUT_URL`: approved HTTPS link on Bank Muscat/OmanNet's domain.
- `BANKMUSCAT_APPROVED=true`: only after merchant approval and link verification.
- `BANKMUSCAT_AMOUNT_MODE=provider-entered`: donor re-enters/confirms the amount on the gateway. The UI states this clearly.
- `BANKMUSCAT_AMOUNT_MODE=query-parameter`: only if the bank documents a supported amount parameter for this exact hosted link. Set `BANKMUSCAT_AMOUNT_PARAMETER` to that documented parameter. Do not guess it.

This is a hosted-link integration, not a merchant API/session integration. Do not place merchant passwords, card data, tokens or bank account numbers in the repository. If Bank Muscat requires API-based session creation, implement its supplied official integration specification server-side before enabling payments; this adapter does not pretend to support an undocumented API.

Amounts are validated server-side as OMR 0.100–500 with up to three decimals. GPay/PhonePe **UPI is not enabled**; cross-border UPI requires a separately approved provider and cannot be inferred from card-wallet support. Your merchant provider determines settlement, conversion, fees and payment availability. A gateway receipt is the authority for payment confirmation. Test transactions and a real settlement check must be completed by the account owner before live launch.

## Feedback

The feedback form opens a pre-filled public GitHub issue. Visitors review and submit it on GitHub. It does not silently send messages or claim feedback was stored. Private feedback would require an additional configured storage or form service.

## Scheduled health

The catalog workflow checks every 30 minutes, performs a full catalog refresh every two hours in Asia/Muscat, and then runs `check_site.py` when `GRETA_PUBLIC_URL` is set as a repository variable. The website's maintenance date is the updater's successful `updatedAt`, never the visitor's browser time.


The source branch's `dobins-indian-catalog/data/status.json` now records a separate `catalogFreshness` entry for each of the eight catalogs: total item count, generation timestamp and newest dated title. `catalog-health.json` records the public endpoint's paginated total, per-page counts and newest title for each catalog, so a 50-item first page is never mistaken for the full catalog.


Health checks GET the public manifest, support page and read-only checkout status. They do not submit payment orders, charge cards, or assert that real settlements succeeded. Their timestamp and results are stored in `data/payment-health.json` for the support page. Checkout remains visibly unavailable until configured.


## Catalog pagination and the 50-entry response

Each catalog endpoint intentionally returns **up to 50 titles per request** so poster metadata and artwork links do not create oversized responses. This is a page size, not a 50-title catalog limit. The manifest advertises the optional `skip` extra, and the endpoint supports paths such as:

- `/catalog/movie/dobins_ml_movie.json` — first page (up to 50).
- `/catalog/movie/dobins_ml_movie/skip=50.json` — next page.
- `/catalog/movie/dobins_ml_movie/skip=100.json` — third page.

The catalog workflow's health probe now follows this pagination and compares the complete endpoint result with the generated snapshot. Keep the page size at 50 unless Nuvio's client-side paging behavior is explicitly changed and tested; changing the response size alone can cause overlapping or skipped pages.
