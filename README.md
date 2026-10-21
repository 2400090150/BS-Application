# BS Handlooms — Full-stack starter

A responsive Indian handloom storefront with a product catalogue, category filters, search, cart, checkout form, order records, and a password-protected admin dashboard.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the extracted `bs-handlooms` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Open `.env` and set a unique `SESSION_SECRET` and a strong `ADMIN_PASSWORD`.
6. Start:
   ```bash
   npm start
   ```
7. Open `http://localhost:3000` for the shop.
8. Open `http://localhost:3000/login` for customer login, registration, Google sign-in (after setup), password recovery and account orders. Open `http://localhost:3000/admin` for the separate administrator sign-in.

The database is created automatically at `data/store.sqlite`; sample products are inserted on first run.

## Deploy on Render
1. Push this repository to GitHub and create a new Render Blueprint using `render.yaml`.
2. Render creates the Node web service and a persistent disk for the SQLite database and uploaded images. The disk requires a paid Render plan.
3. The first start safely copies the committed `data/store.sqlite` and uploaded images to the persistent disk if it is empty. Later deploys keep the disk data.
4. Render generates `SESSION_SECRET` and sets production mode and the persistent data directory. Do not add `.env` or secrets to Git.
5. To enable email-based password recovery, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `APP_BASE_URL` in the Render service's environment settings. Google sign-in and Drive image import are optional; set `GOOGLE_CLIENT_ID`, `GOOGLE_DRIVE_API_KEY`, and `GOOGLE_DRIVE_APP_ID` to enable them.
6. After deployment, open the service URL and verify the storefront and sign-in pages. Configure the deployed domain in Google OAuth settings if Google sign-in is enabled.

## Included
- Mobile-responsive BS Handlooms storefront with premium traditional visual style
- Sample products across sarees, clothing, dupattas, fabrics, and home & living
- Search, category filtering, sorting, cart, quantity controls and stock checks
- Admin product pricing with an original price, an optional exact offer price, and a 0–100 whole-number discount percentage. A directly entered offer price takes priority and updates the displayed percentage; entering only a percentage calculates the offer price.
- The Special Offers editor includes the same original-price, offer-price and discount controls as Product catalogue. Saving there updates the product itself, so its catalogue, special-offer card, and checkout price stay in sync.
- Admin-set per-product whole-number discount percentages from 0–100 with automatic discounted pricing across the storefront, cart, and server-calculated orders. Orders retain the original unit price, discount percentage, and final unit price; this is independent of homepage offer banners.
- Admin product image uploads from the device or an available photo/Drive file provider
- Website Images editor with device uploads, saved-image library selection, URL alternatives, previews and Google Drive import
- Admins can manage separate page logos from Admin → Website images. Each logo setting controls its own page header and footer, sign-in, password-recovery, or admin header, and transparent PNG uploads allow the page background to show through.
- Server-side order total and stock validation, using active offer prices and preserving the charged item prices in order history
- Stock is deducted on order confirmation, restored once for eligible pre-shipment cancellations, and only restocked after shipment with explicit admin return approval
- Customer accounts show a dated order-status timeline, allow cancellation only while an order is awaiting admin confirmation, and explain that delivered items are not returnable. Customer cancellations are enforced server-side and recorded in order status history.
- Checkout form that records orders without taking online payment
- Customer registration, Gmail/password login, customer profile and order history
- Passwords must contain 6–12 characters. For password recovery, users submit their registered Gmail address; the request and its `PENDING`, `APPROVED`, `REJECTED`, or `USED` status are stored in SQLite. The admin dashboard lists request Gmail addresses and dates and offers approve/reject actions. Administrators should verify the user's identity through a trusted contact method before approval. Returning in the requesting browser and entering the same Gmail checks the saved status; an approved request reveals the new-password form, and the one-time approval is consumed on save. A persistent HttpOnly browser credential supplements the database approval so a Gmail address alone cannot authorize a password change. Passwords are stored as bcrypt hashes, and customer/admin sessions for that account are invalidated after recovery. Signed-in customers can change their password at any time from their account by confirming their current password.
- Google sign-in using Google Identity Services (requires `GOOGLE_CLIENT_ID`)
- Separate protected admin login, product create/edit/hide, inventory management, order list and status updates
- Admin category management with optional images/descriptions, active status, duplicate-name checks, search/filter, and safe product reassignment when deleting categories. Inactive categories and their products are excluded from customer catalogue, collection, offer, and checkout feeds.
- Admin-selected homepage Shop the collection with a persistent maximum of 8 products. The product catalogue shows each product's homepage selection control and current selection count.
- Three independently editable 766 × 139 offer banners for the home page, New Collection page, and Special Offers page. Admins can upload/preview, publish, enable/disable, or remove each banner separately; settings persist in SQLite and uploaded images use the shared persistent uploads directory.
- SQLite persistence

## Optional sign-in setup
- Google sign-in: create a Google OAuth 2.0 Web application client ID, add your local/deployed domains to its authorized JavaScript origins, then set `GOOGLE_CLIENT_ID` in `.env`. Google sign-in remains unavailable until this is configured.
- Google Drive image import in Admin → Website Images: enable Google Picker API and Google Drive API in the same Cloud project; configure the OAuth client with the Drive read-only scope and authorized website origins; then set `GOOGLE_DRIVE_API_KEY` (restricted to your domain and Picker API) and `GOOGLE_DRIVE_APP_ID` (the Cloud project number) in `.env`. The selected image is downloaded and saved to the site’s persistent uploads directory before it is applied.

## Important before public launch
This is a working starter project, not yet a production-hardened commerce deployment.
- Online payment gateways are intentionally not connected. The checkout currently records an order with a payment preference; it does not charge the customer.
- Replace sample product images, prices, descriptions and inventory with your real catalogue and use images you own or are licensed to use.
- Configure HTTPS, rate limiting, CSRF protection, backups, privacy/return/shipping policies, and monitoring before launch. Sessions are stored in SQLite and require the same persistent storage as the database.
- Newsletter signup is a visual placeholder and does not store emails.
- For public hosting, use a persistent disk for SQLite or migrate to a managed database. Set `NODE_ENV=production` and configure the session cookie/HTTPS correctly.
- Add a proper payment gateway later (for example, Razorpay) using server-side order creation and signature verification; never trust client-side payment confirmation.
- Change the initial admin password before sharing or deployment.

## API overview
- `GET /api/products`
- `GET /api/products?homepage=1` (admin-selected homepage products, maximum 8)
- `GET /api/products/:id`
- `POST /api/orders`
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/google`, `GET /api/auth/me`
- `PUT /api/auth/password` (authenticated customer session required)
- `POST /api/auth/password-reset/request`, `GET /api/auth/password-reset/status?email=...`, `POST /api/auth/password-reset/complete`
- `GET /api/auth/orders`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/customers`
- `GET /api/admin/password-reset-requests` (latest reset request and status for each customer)
- `POST /api/admin/password-reset-requests/:id/approve` and `/reject` (authorized admin decisions for the exact request and registered Gmail)
- `GET /api/admin/products`
- `PATCH /api/admin/products/:id/homepage-shop` (body: `{ "selected": true|false }`; at most 8 selected products)
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/:id`
- `PATCH /api/admin/categories/:id/status`
- `DELETE /api/admin/categories/:id` (provide `reassign_to` when products are assigned)
- `GET /api/admin/offer-banner`
- `PUT /api/admin/offer-banner` (provide `image` and boolean `active`)
- `GET /api/admin/offer-banners` (returns independent `home`, `new-collection`, and `offers` settings)
- `PUT /api/admin/offer-banners/:placement` (placement: `home`, `new-collection`, or `offers`; provide `image` and boolean `active`)
- `DELETE /api/admin/products/:id` (hides product)
- `GET /api/admin/orders`
- `GET /api/admin/orders/clear-audit` and `POST /api/admin/orders/clear` (Main Admin only; clear requires `{ "confirmation": "CLEAR ALL ORDERS" }`, preserves product inventory and writes an audit entry)
- `PATCH /api/admin/orders/:id`
- `GET /api/admin/summary`
#   B S - H n d l o o m s .  
 