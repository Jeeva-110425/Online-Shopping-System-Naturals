require('dotenv').config();

const bcrypt = require('bcryptjs');
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
const { createHmac, randomBytes, timingSafeEqual } = require('crypto');

const app = express();
const port = Number(process.env.PORT) || 3000;
const jwtSecret = process.env.JWT_SECRET;
const storeName = String(process.env.STORE_NAME || 'Naturals').trim().slice(0, 40) || 'Naturals';

if (!jwtSecret) {
  throw new Error('JWT_SECRET is required. Copy .env.example to .env and set a secret.');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({
  limit: '20kb',
  verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  tag: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, required: true, min: 0 },
  rating: { type: Number, required: true, min: 0, max: 5 },
  image: { type: String, required: true }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customer: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  paymentMethod: { type: String, enum: ['Razorpay', 'UPI QR', 'Cash on Delivery'], required: true },
  status: { type: String, default: 'Payment pending' },
  razorpayOrderId: { type: String, unique: true, sparse: true },
  razorpayPaymentId: { type: String, unique: true, sparse: true },
  razorpayQrCodeId: { type: String, unique: true, sparse: true },
  razorpayQrImageUrl: { type: String },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }
  }],
  total: { type: Number, required: true, min: 0 }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);

async function razorpayRequest(endpoint, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return { response, data: await response.json() };
}

function isValidRazorpaySignature(secret, payload, signature) {
  if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

function createUpiPaymentLink({ amount, orderId, merchantName, upiId }) {
  const safeAmount = Number(amount || 0).toFixed(2);
  const safeMerchantName = String(merchantName || 'Naturals').trim() || 'Naturals';
  const safeUpiId = String(upiId || 'naturals@upi').trim() || 'naturals@upi';
  return `upi://pay?pa=${encodeURIComponent(safeUpiId)}&pn=${encodeURIComponent(safeMerchantName)}&am=${safeAmount}&cu=INR&tn=${encodeURIComponent(`Order ${orderId}`)}`;
}

const replacementImages = {
  mixingBowls: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=900&q=80',
  rollingPin: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?auto=format&fit=crop&w=900&q=80'
};

const seedProducts = require('./products.json');

function createToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' });
}

async function optionalAuth(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization) return next();

  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return next();

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.userId = payload.sub;
    return next();
  } catch {
    req.userId = null;
    return next();
  }
}

async function requireAuth(req, res, next) {
  return optionalAuth(req, res, () => {
    if (!req.userId) return res.status(401).json({ message: 'Log in to view your orders.' });
    next();
  });
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 }));

app.post('/api/checkout/create-order', optionalAuth, async (req, res, next) => {
  try {
    const { items, customer, email, phone, address, paymentMethod = 'upi_qr' } = req.body;
    const selectedPaymentMethod = String(paymentMethod || 'upi_qr').toLowerCase();

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ message: 'Your order must contain at least one item.' });
    }
    if (!customer?.trim() || !/^\S+@\S+\.\S+$/.test(String(email || '')) || !phone?.trim() || !address?.trim()) {
      return res.status(400).json({ message: 'Enter your name, valid email, phone number, and delivery address.' });
    }

    const quantities = new Map();
    for (const item of items) {
      if (!mongoose.isValidObjectId(item.id) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50) {
        return res.status(400).json({ message: 'One or more cart items are invalid.' });
      }
      const quantity = (quantities.get(item.id) || 0) + item.qty;
      if (quantity > 50) return res.status(400).json({ message: 'An item quantity cannot exceed 50.' });
      quantities.set(item.id, quantity);
    }

    const products = await Product.find({ _id: { $in: [...quantities.keys()] } }).lean();
    if (products.length !== quantities.size || products.some(product => product.stock < quantities.get(String(product._id)))) {
      return res.status(400).json({ message: 'One or more products are unavailable in the requested quantity.' });
    }

    const orderItems = products.map(product => ({
      productId: product._id,
      name: product.name,
      qty: quantities.get(String(product._id)),
      price: product.price
    }));
    const total = orderItems.reduce((sum, item) => sum + item.qty * item.price, 0);
    const amount = Math.round(total * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      return res.status(400).json({ message: 'The order total is not a valid payment amount.' });
    }

    const id = `NAT-${Date.now()}-${randomBytes(8).toString('hex').toUpperCase()}`;

    if (selectedPaymentMethod === 'cod') {
      const order = await Order.create({
        id,
        userId: req.userId || null,
        customer: customer.trim(),
        email: String(email).trim().toLowerCase(),
        phone: phone.trim(),
        address: address.trim(),
        paymentMethod: 'Cash on Delivery',
        status: 'Cash on delivery pending',
        items: orderItems,
        total
      });
      return res.status(201).json({
        receipt: id,
        businessName: storeName,
        paymentMethod: 'cod',
        amount: order.total,
        currency: 'INR',
        qr: null,
        message: 'Cash on delivery selected. Pay the delivery agent when your order arrives.',
        status: order.status
      });
    }

    if (selectedPaymentMethod === 'upi_qr') {
      const upiId = String(process.env.UPI_ID || 'naturals@upi').trim() || 'naturals@upi';
      const upiLink = createUpiPaymentLink({
        amount: total,
        orderId: id,
        merchantName: storeName,
        upiId
      });
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiLink)}`;
      const order = await Order.create({
        id,
        userId: req.userId || null,
        customer: customer.trim(),
        email: String(email).trim().toLowerCase(),
        phone: phone.trim(),
        address: address.trim(),
        paymentMethod: 'UPI QR',
        status: 'UPI pending',
        items: orderItems,
        total
      });
      return res.status(201).json({
        keyId: process.env.RAZORPAY_KEY_ID || 'demo',
        razorpayOrderId: `upi-${id}`,
        amount: amount,
        currency: 'INR',
        receipt: id,
        businessName: storeName,
        paymentMethod: 'upi_qr',
        qr: { id: `upi-${id}`, imageUrl: qrUrl, expiresAt: Math.floor(Date.now() / 1000) + 3600, upiLink },
        qrMessage: 'Scan the UPI QR and complete the payment in your bank or UPI app.',
        status: order.status
      });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ message: 'Razorpay is not configured. Add your API keys to the server .env file.' });
    }

    const { response: razorpayResponse, data: razorpayOrder } = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({ amount, currency: 'INR', receipt: id })
    });
    if (!razorpayResponse.ok) {
      console.error('Razorpay order creation failed:', razorpayOrder.error?.code || razorpayResponse.status);
      return res.status(502).json({ message: razorpayOrder.error?.description || 'Razorpay could not start the payment. Check your API keys and try again.' });
    }

    const order = await Order.create({
      id,
      userId: req.userId || null,
      customer: customer.trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone.trim(),
      address: address.trim(),
      paymentMethod: 'Razorpay',
      status: 'Payment pending',
      razorpayOrderId: razorpayOrder.id,
      items: orderItems,
      total
    });

    const closeBy = Math.floor(Date.now() / 1000) + 30 * 60;
    const { response: qrResponse, data: qrCode } = await razorpayRequest('/payments/qr_codes', {
      method: 'POST',
      body: JSON.stringify({
        type: 'upi_qr',
        name: `${storeName} ${id}`.slice(0, 40),
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: amount,
        description: `${storeName} website order ${id}`,
        close_by: closeBy,
        notes: { order_id: id, store: storeName }
      })
    });

    let qrMessage = '';
    if (qrResponse.ok) {
      order.razorpayQrCodeId = qrCode.id;
      order.razorpayQrImageUrl = qrCode.image_url;
      await order.save();
    } else {
      console.error('Razorpay QR creation failed:', qrCode.error?.code || qrResponse.status);
      qrMessage = qrCode.error?.description || 'Razorpay UPI QR is unavailable for this account. Use Checkout instead.';
    }

    res.status(201).json({
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      receipt: id,
      businessName: storeName,
      paymentMethod: 'razorpay',
      qr: qrResponse.ok ? { id: qrCode.id, imageUrl: qrCode.image_url, expiresAt: qrCode.close_by } : null,
      qrMessage
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const products = await Product.find().sort({ name: 1 }).lean();
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.post('/api/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: 'Enter a name, valid email, and password of at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash });
    res.status(201).json({ token: createToken(user), name: user.name });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with that email already exists.' });
    next(error);
  }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    res.json({ token: createToken(user), name: user.name });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

app.post('/api/checkout/verify-payment', async (req, res, next) => {
  try {
    const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature } = req.body;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(400).json({ message: 'Payment verification details are incomplete.' });
    }

    const order = await Order.findOne({ razorpayOrderId });
    if (!order) return res.status(404).json({ message: 'The payment order could not be found.' });
    if (order.status === 'Paid' && order.razorpayPaymentId === razorpayPaymentId) {
      return res.json({ id: order.id, status: order.status });
    }
    if (order.status !== 'Payment pending') {
      return res.status(409).json({ message: 'This order is no longer awaiting payment.' });
    }

    if (!isValidRazorpaySignature(
      process.env.RAZORPAY_KEY_SECRET,
      `${order.razorpayOrderId}|${razorpayPaymentId}`,
      razorpaySignature
    )) {
      return res.status(400).json({ message: 'Razorpay payment verification failed. The order was not marked as paid.' });
    }

    order.razorpayPaymentId = razorpayPaymentId;
    order.status = 'Paid';
    await order.save();
    res.json({ id: order.id, status: order.status });
  } catch (error) {
    next(error);
  }
});

app.get('/api/checkout/qr-status/:receipt', async (req, res, next) => {
  try {
    const order = await Order.findOne({ id: req.params.receipt });
    if (!order) return res.status(404).json({ message: 'The payment order could not be found.' });
    if (order.status === 'Paid') return res.json({ id: order.id, status: order.status });
    if (!order.razorpayQrCodeId) return res.status(404).json({ message: 'This order has no Razorpay QR code.' });

    const { response, data } = await razorpayRequest(
      `/payments/qr_codes/${encodeURIComponent(order.razorpayQrCodeId)}/payments?count=10`
    );
    if (!response.ok) {
      return res.status(502).json({ message: data.error?.description || 'Could not check the Razorpay QR payment yet.' });
    }

    const expectedAmount = Math.round(order.total * 100);
    const payment = data.items?.find(item => item.status === 'captured' && item.amount === expectedAmount);
    if (payment) {
      order.razorpayPaymentId = payment.id;
      order.status = 'Paid';
      await order.save();
    }
    res.json({ id: order.id, status: order.status });
  } catch (error) {
    next(error);
  }
});

app.post('/api/razorpay/webhook', async (req, res, next) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get('x-razorpay-signature');
    if (!webhookSecret || !isValidRazorpaySignature(webhookSecret, req.rawBody, signature)) {
      return res.status(400).json({ message: 'Invalid Razorpay webhook signature.' });
    }
    if (req.body.event !== 'qr_code.credited') return res.json({ received: true });

    const qrCode = req.body.payload?.qr_code?.entity;
    const payment = req.body.payload?.payment?.entity;
    if (!qrCode?.id || !payment?.id) return res.status(400).json({ message: 'QR payment details are missing.' });

    const order = await Order.findOne({ razorpayQrCodeId: qrCode.id });
    if (!order) return res.json({ received: true });
    if (payment.status === 'captured' && payment.amount === Math.round(order.total * 100)) {
      order.razorpayPaymentId = payment.id;
      order.status = 'Paid';
      await order.save();
    }
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/style.js', (req, res) => res.sendFile(path.join(__dirname, 'style.js')));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ message: 'Server error. Please try again.' });
});

async function start() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/naturals_shop');
  if (await Product.countDocuments() === 0) await Product.insertMany(seedProducts);
  await Product.updateOne(
    { name: 'Mixing Bowl Set', image: { $regex: 'photo-1577308856961-8b3f43d7f9cd' } },
    { $set: { image: replacementImages.mixingBowls } }
  );
  await Product.updateOne(
    { name: 'Wooden Rolling Pin', image: { $regex: 'photo-1509440159596-024ec1e45c1c' } },
    { $set: { image: replacementImages.rollingPin } }
  );
  app.listen(port, () => console.log(`Naturals shop running at http://localhost:${port}`));
}

start().catch(error => {
  console.error('Unable to start the server:', error.message);
  process.exit(1);
});