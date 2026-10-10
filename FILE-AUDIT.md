# File and backend audit

Reviewed 9 October 2026. Cleanup completed: removed the duplicate portal HTML and generated preview logs. Dependencies were excluded from the first-party source audit.

## Cleanup candidates

| File / folder | Finding | Recommendation |
| --- | --- | --- |
| `preview-server.log`, `preview-server-error.log` | Generated preview output, removed. | Preview output now goes to temporary storage. |
| `portal.html` | Duplicate HTML removed; server redirects the URL to `profile.html`, preserving its query string. | Cleanup complete. |
| `node_modules/` | Installed third-party dependencies. | Recreated with `npm ci`; exclude from source control. Needed locally while running. |

No other unused whole first-party files were identified. Old blog, tracking and sample-event HTML files are already absent; server redirects preserve those URLs.

## Current first-party inventory

| File / folder | Purpose | Keep? |
| --- | --- | --- |
| `index.html` | Home | Yes |
| `about.html` | About | Yes |
| `contact.html` | Contact/support | Yes |
| `events.html` | Events listing | Yes |
| `event-detail.html` | Event detail | Yes |
| `shop.html` | Products listing | Yes |
| `sproduct.html` | Product detail | Yes |
| `cart.html` | Cart | Yes |
| `wishlist.html` | Wishlist | Yes |
| `signin.html` | Registration, sign-in and recovery | Yes |
| `profile.html` | Customer portal and newsletter link results | Yes |
| `admin.html` | Administration and owner tools | Yes |
| `help.html` | Help | Yes |
| `privacy.html` | Privacy policy | Yes |
| `terms.html` | Terms | Yes |
| `script.js` | Shared frontend behavior, API calls, theme interactions and visibility | Yes |
| `admin-dashboard.js` | Administration, menu editor, newsletters and backups | Yes |
| `style.css` | Site styles and animations | Yes |
| `server.js` | Backend, authentication, storage, email, payments and backups | Yes |
| `package.json`, `package-lock.json` | Commands, dependencies and reproducible installation | Yes |
| `navigation.test.js`, `navigation-settings.test.js`, `smoke.test.js`, `persistence.test.js` | Regression checks; not served publicly | Yes |
| `README.md`, `.env.example` | Setup documentation and configuration template | Yes |
| `.env` | Private local configuration; never publish or commit | Yes, locally |
| `data.json` | Local database and initial production seed | Yes; do not delete |
| `img/logo.png`, `img/logo3.png` | Referenced branding assets | Yes |
| `uploads/` | Uploaded images, including an image referenced by current event data | Yes; back up separately |
| Outer-folder `package.json`, `.gitignore` | Convenience commands and private/generated-file exclusions | Yes |

## Shared backend and publishing

Accounts, products, events, orders, support requests, newsletter subscriptions and menu settings use the Express backend. Administration changes saved on the deployed server are shared by visitors on their next page load or refresh. There is no live push to an already-open page.

Local HTML/CSS/JavaScript edits require upload or redeployment to change the published site. Localhost data is separate from the deployed database. A connected hosting Git repository can enable automatic deployments; this local checkout has no Git repository, so that connection cannot be confirmed here.

Production storage expects PostgreSQL (`DATABASE_URL`) and persistent uploaded-image storage (`UPLOADS_PATH`). Database backups do not include uploaded image files.

## Email and backup readiness

The local `.env` currently has empty `RESEND_API_KEY`, `EMAIL_FROM`, `DATABASE_URL` and `BACKUP_SECRET` values. Its `PUBLIC_BASE_URL` points to localhost. Hosted environment settings may differ and were not inspected.

Local development simulates email and prints links to the server log. Real inbox delivery needs a mail provider, sending address and the deployed HTTPS `PUBLIC_BASE_URL`. Verification, rejection of unverified sign-ins, newsletter confirmation and unsubscribe pass automated tests with simulated delivery. Live inbox delivery was not tested.

Encrypted owner backup download, preview and restore need `BACKUP_SECRET` configured. Keep the key: changing or losing it prevents restoration of old backups.

## Changes verified in this pass

- Backup preview/restore buttons have 14px vertical and 20px horizontal padding and fit at desktop and phone widths.
- Shop visibility hides shop/product links, collection sections and dynamically inserted shop links; reenabling restores them. Events stay visible.
- Anonymous newsletter confirmation/unsubscribe links show a result without requiring sign-in or leaving a portal loading panel.
- Five automated test suites passed; targeted browser checks passed.

