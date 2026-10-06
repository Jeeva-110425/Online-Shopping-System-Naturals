# Naturals Shop

## Run locally

Requirements: Node.js and MongoDB. The server seeds the sample products the first time it connects to an empty database.

In PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set a long random `JWT_SECRET`, your displayed store label in `STORE_NAME`, and your Razorpay **Test Mode** Key ID and Key Secret as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Keep these server-side values private; never put the Key Secret in browser code or commit `.env`. Keep the default `MONGODB_URI` when using the local MongoDB service, or set it to your MongoDB Atlas connection string. Then run:

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The Express server serves the shopping page and its `/api` routes from the same origin.

## API

- `GET /api/health` checks the server and database connection.
- `GET /api/products` lists products.
- `POST /api/register` and `POST /api/login` create accounts and issue JWTs.
- `GET /api/orders` lists the logged-in customer's orders.
- `POST /api/checkout/create-order` creates a Razorpay order using server-calculated product prices.
- `POST /api/checkout/verify-payment` verifies Razorpay's payment signature before marking an order paid.
- `GET /api/checkout/qr-status/:receipt` checks Razorpay for a captured QR payment.
- `POST /api/razorpay/webhook` accepts signed `qr_code.credited` notifications.

Checkout creates a single-use, fixed-amount UPI QR through Razorpay and displays the QR, Naturals store name, order total, and expiry. Razorpay supplies the actual QR image and merchant settlement details; this website does not construct payment QR data itself. Razorpay requires UPI QR activation for the merchant account. If QR creation is unavailable, the page offers Razorpay Standard Checkout as a fallback.

For automatic order updates after the customer leaves the page, configure a Razorpay webhook in Dashboard → **Account & Settings → Webhooks**. Set its URL to `https://your-domain/api/razorpay/webhook`, subscribe to `qr_code.credited`, and place the webhook secret in `RAZORPAY_WEBHOOK_SECRET`. Localhost is not publicly reachable by Razorpay; use a deployed HTTPS URL or a secure development tunnel for webhook testing. The page also has a manual status check that asks Razorpay whether the QR payment was captured.

Test with Razorpay Test Mode keys first. Switch to Live Mode keys only after Razorpay activates your account and UPI QR feature and your test payments succeed. Configure your legal business name and UPI merchant details in Razorpay Dashboard; `STORE_NAME` is the website label, while Razorpay's account profile supplies the merchant details shown by UPI apps.