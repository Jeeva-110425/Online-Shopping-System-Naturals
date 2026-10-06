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

## Publish a GitHub Pages preview

Every push to `main` that changes `shopping/` deploys a static preview through `.github/workflows/pages.yml`. After the workflow succeeds, open `https://jeeva-110425.github.io/Online-Shopping-System-Naturals/`. If Pages has not been enabled for the repository yet, select **Settings → Pages → Build and deployment → Source: GitHub Actions** and rerun the workflow.

The Pages version supports product browsing, filtering, searching, and a cart saved in the visitor's browser. GitHub Pages cannot run this project's Express API, so sign-in, order history, and real checkout are unavailable in the preview. Deploy the Node.js server and database using the Render instructions below for the complete application.

## Deploy on Render

This app includes a Render Blueprint in the repository root (`render.yaml`). Create a MongoDB Atlas database and database user, then [deploy the Blueprint on Render](https://render.com/deploy?repo=https://github.com/Jeeva-110425/Online-Shopping-System-Naturals). Render will create the web service and generate `JWT_SECRET`; enter the Atlas connection string for `MONGODB_URI` and Razorpay API credentials when prompted. In Atlas, allow network access from Render (or temporarily allow `0.0.0.0/0`) and create a database user for the connection string. The GitHub Pages frontend is configured to use `https://naturals-shop.onrender.com`; if Render assigns a different service URL, update `window.NATURALS_API_URL` in `shopping/api-config.js` and push the change.

After deployment, use the Render service's public HTTPS URL for the complete app; unlike the GitHub Pages preview, this server runs the API and serves the storefront on the same origin. The server permits API requests from the GitHub Pages origin; set `FRONTEND_ORIGIN` if you use a different static-site origin. Add Razorpay Test Mode credentials (`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`) in the service's environment settings to enable verified UPI QR payments and Razorpay Checkout. Set `RAZORPAY_WEBHOOK_SECRET` there as well if configuring the webhook. Never commit these values or put them in browser code. The free Render service may sleep when idle.

## API

- `GET /api/health` checks the server and database connection.
- `GET /api/products` lists products.
- `POST /api/register` and `POST /api/login` create accounts and issue JWTs.
- `GET /api/orders` lists the logged-in customer's orders.
- `POST /api/checkout/create-order` creates a Razorpay order using server-calculated product prices.
- `POST /api/checkout/verify-payment` verifies Razorpay's payment signature before marking an order paid.
- `GET /api/checkout/qr-status/:receipt` checks Razorpay for a captured QR payment.
- `POST /api/razorpay/webhook` accepts signed `qr_code.credited` notifications.

Checkout creates a single-use, fixed-amount UPI QR through Razorpay and displays the QR, Naturals store name, order total, and expiry. Razorpay supplies the actual QR image and merchant settlement details; this website does not construct payment QR data itself. Both UPI QR and Razorpay Checkout require valid Razorpay API credentials on the server. Razorpay requires UPI QR activation for the merchant account. If QR creation is unavailable, the page offers Razorpay Standard Checkout as a fallback. Cash on delivery does not require Razorpay.

For automatic order updates after the customer leaves the page, configure a Razorpay webhook in Dashboard → **Account & Settings → Webhooks**. Set its URL to `https://your-domain/api/razorpay/webhook`, subscribe to `qr_code.credited`, and place the webhook secret in `RAZORPAY_WEBHOOK_SECRET`. Localhost is not publicly reachable by Razorpay; use a deployed HTTPS URL or a secure development tunnel for webhook testing. The page also has a manual status check that asks Razorpay whether the QR payment was captured.

Test with Razorpay Test Mode keys first. Switch to Live Mode keys only after Razorpay activates your account and UPI QR feature and your test payments succeed. Configure your legal business name and UPI merchant details in Razorpay Dashboard; `STORE_NAME` is the website label, while Razorpay's account profile supplies the merchant details shown by UPI apps.