const $ = id => document.getElementById(id);
const isGitHubPages = window.location.hostname.endsWith('.github.io')
  || new URLSearchParams(window.location.search).has('github-pages-preview');

const readStorage = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const formatCurrency = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

let products = [];
let cart = readStorage('cart', {});
let category = 'All';
let registering = false;
let searchTerm = '';
let sortMode = 'featured';
let activePaymentOrder = null;
let selectedPaymentMethod = 'upi_qr';

function getSelectedPaymentMethod() {
  const checkedInput = document.querySelector('input[name="paymentMethod"]:checked');
  return checkedInput ? checkedInput.value : selectedPaymentMethod;
}

function setPaymentMethodUi(method) {
  selectedPaymentMethod = method;
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
    input.checked = input.value === method;
  });
  const paymentStatus = $('paymentStatus');
  if (method === 'cod') {
    paymentStatus.textContent = 'Cash on delivery selected. We will confirm your order at delivery.';
    $('paymentQr').hidden = true;
    $('checkQrPayment').hidden = true;
    $('checkoutFallback').hidden = true;
    $('paymentSubmit').textContent = 'Place COD order';
  } else if (method === 'razorpay') {
    paymentStatus.textContent = 'Razorpay checkout will be used for this order.';
    $('paymentQr').hidden = true;
    $('checkQrPayment').hidden = true;
    $('checkoutFallback').hidden = false;
    $('paymentSubmit').textContent = 'Generate Razorpay order';
  } else {
    paymentStatus.textContent = 'Scan the UPI QR with your phone and complete the payment.';
    $('paymentQr').hidden = true;
    $('checkQrPayment').hidden = true;
    $('checkoutFallback').hidden = true;
    $('paymentSubmit').textContent = 'Generate UPI QR';
  }
}

const showToast = message => {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
};

function renderFilters() {
  const filters = ['All', 'Household', 'Kitchen', 'Cooking', 'Under ₹500'];
  $('filters').innerHTML = filters.map(filter => {
    const active = filter === 'All' ? category === 'All' : filter === 'Under ₹500' ? category === 'Under ₹500' : category === filter;
    return `<button class="${active ? 'on' : ''}" data-filter="${filter}">${filter}</button>`;
  }).join('');
}

function getVisibleProducts() {
  let result = [...products];

  if (category !== 'All') {
    if (category === 'Under ₹500') {
      result = result.filter(product => product.price < 500);
    } else {
      result = result.filter(product => product.category === category);
    }
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    result = result.filter(product =>
      [product.name, product.category, product.description, product.tag].join(' ').toLowerCase().includes(term)
    );
  }

  switch (sortMode) {
    case 'low':
      result.sort((a, b) => a.price - b.price);
      break;
    case 'high':
      result.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      result.sort((a, b) => b.rating - a.rating);
      break;
    default:
      result.sort((a, b) => b.rating - a.rating || b.stock - a.stock);
  }

  return result;
}

function renderProducts() {
  const visibleProducts = getVisibleProducts();

  $('grid').innerHTML = visibleProducts.length
    ? visibleProducts.map(product => `
      <article class="card">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        <div class="info">
          <div class="product-top">
            <span class="product-tag">${product.tag}</span>
            <span class="rating">★ ${product.rating}</span>
          </div>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="buy">
            <span class="price">${formatCurrency(product.price)}</span>
            <button class="primary" data-add="${product._id}" ${product.stock < 1 ? 'disabled' : ''}>${product.stock < 1 ? 'Sold out' : 'Add to cart'}</button>
          </div>
        </div>
      </article>
    `).join('')
    : '<p class="empty-state">No products fit this filter yet.</p>';
}

function saveCart() {
  writeStorage('cart', cart);
  renderCart();
}

function renderCart() {
  const ids = Object.keys(cart).filter(id => products.find(product => product._id === id));
  $('count').textContent = ids.reduce((count, id) => count + cart[id], 0);

  let total = 0;
  $('cartItems').innerHTML = ids.length ? ids.map(id => {
    const product = products.find(item => item._id === id);
    total += product.price * cart[id];
    return `
      <div class="line">
        <span>${product.name}</span>
        <span class="qty"><button data-dec="${id}">−</button> ${cart[id]} <button data-add="${id}">+</button></span>
        <b>${formatCurrency(product.price * cart[id])}</b>
      </div>
    `;
  }).join('') : '<p>Your cart is empty. Add something from the shop.</p>';

  $('total').textContent = formatCurrency(total);
}

function renderAuth() {
  const name = localStorage.getItem('name');
  $('who').textContent = name ? 'Hi, ' + name : '';
  $('authBtn').textContent = name ? 'Log out' : 'Log in';
  $('ordersBtn').hidden = !name;
}

function setAuthMode(reg) {
  registering = reg;
  $('authTitle').textContent = reg ? 'Create account' : 'Log in';
  $('authSubmit').textContent = reg ? 'Create account' : 'Log in';
  $('authSwitch').textContent = reg ? 'Have an account? Log in' : 'New here? Create an account';
  $('aName').hidden = !reg;
}

async function renderOrders() {
  $('ordersList').textContent = 'Loading orders...';
  try {
    const orders = await api('/orders');
    $('ordersList').innerHTML = orders.length ? orders.map(order => `
    <div class="order">
      <b>${order.id}</b> · ${order.status}<br>
      ${order.items.map(item => `${item.name} × ${item.qty}`).join(', ')}<br>
      <small>${new Date(order.createdAt).toLocaleDateString()} · ${formatCurrency(order.total)}</small>
    </div>
    `).join('') : '<p>No orders yet.</p>';
  } catch (error) {
    $('ordersList').textContent = error.message;
  }
}

const api = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
};

document.addEventListener('click', async event => {
  const target = event.target;
  const closeButton = target.closest('[data-close]');

  if (target.dataset.filter) {
    category = target.dataset.filter === 'All' ? 'All' : target.dataset.filter === 'Under ₹500' ? 'Under ₹500' : target.dataset.filter;
    renderFilters();
    renderProducts();
  }

  if (target.dataset.add) {
    cart[target.dataset.add] = (cart[target.dataset.add] || 0) + 1;
    saveCart();
    showToast('Added to cart');
  }

  if (target.dataset.dec) {
    cart[target.dataset.dec] -= 1;
    if (cart[target.dataset.dec] <= 0) delete cart[target.dataset.dec];
    saveCart();
  }

  if (closeButton) {
    $('cart').hidden = true;
    $('authModal').hidden = true;
    $('paymentModal').hidden = true;
    $('ordersModal').hidden = true;
  }
});

$('searchInput').addEventListener('input', event => {
  searchTerm = event.target.value;
  renderProducts();
});

$('sortSelect').addEventListener('change', event => {
  sortMode = event.target.value;
  renderProducts();
});

$('shopNowBtn').addEventListener('click', () => {
  document.getElementById('grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('featuredBtn').addEventListener('click', () => {
  category = 'Kitchen';
  renderFilters();
  renderProducts();
});

$('cartBtn').onclick = () => {
  $('cart').hidden = false;
  renderCart();
};

$('authBtn').onclick = () => {
  if (isGitHubPages) {
    showToast('Sign-in needs the online server.');
    return;
  }
  if (localStorage.getItem('token')) {
    localStorage.removeItem('token');
    localStorage.removeItem('name');
    renderAuth();
  } else {
    setAuthMode(false);
    $('authModal').hidden = false;
  }
};

$('authSwitch').onclick = () => setAuthMode(!registering);

$('authSubmit').onclick = async () => {
  try {
    const body = {
      email: $('aEmail').value,
      password: $('aPass').value,
      name: $('aName').value
    };
    const data = await api(registering ? '/register' : '/login', { method: 'POST', body });
    localStorage.setItem('token', data.token);
    localStorage.setItem('name', data.name);
    $('authModal').hidden = true;
    $('authMsg').textContent = '';
    renderAuth();
    showToast('Welcome back!');
  } catch (error) {
    $('authMsg').textContent = error.message;
  }
};

$('checkout').onclick = () => {
  if (!Object.keys(cart).length) {
    $('cartMsg').textContent = 'Your cart is empty.';
    return;
  }
  if (isGitHubPages) {
    $('cartMsg').textContent = 'Checkout needs the online server. This GitHub Pages site is a preview.';
    return;
  }
  $('cartMsg').textContent = '';
  renderCart();
  $('paymentAmount').textContent = $('total').textContent;
  $('paymentReference').textContent = 'Not created';
  $('paymentQr').hidden = true;
  $('checkQrPayment').hidden = true;
  $('checkoutFallback').hidden = true;
  $('paymentSubmit').hidden = false;
  activePaymentOrder = null;
  setPaymentMethodUi(getSelectedPaymentMethod());
  $('paymentModal').hidden = false;
};

async function verifyCheckoutPayment(payment) {
  $('paymentStatus').textContent = 'Verifying your payment...';
  try {
    const verifiedOrder = await api('/checkout/verify-payment', { method: 'POST', body: payment });
    cart = {};
    writeStorage('cart', cart);
    renderCart();
    if (localStorage.getItem('token')) renderOrders();
    $('paymentModal').hidden = true;
    $('paymentForm').reset();
    $('cart').hidden = false;
    $('cartMsg').className = 'msg ok';
    $('cartMsg').textContent = `Payment verified. Order: ${verifiedOrder.id}`;
    showToast('Payment successful');
  } catch (error) {
    $('paymentStatus').textContent = error.message;
    showToast(error.message);
  }
}

function openRazorpayCheckout(order) {
  const checkout = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    name: order.businessName,
    description: `Order ${order.receipt}`,
    order_id: order.razorpayOrderId,
    prefill: {
      name: $('payName').value.trim(),
      email: $('payEmail').value.trim(),
      contact: $('payPhone').value.trim()
    },
    theme: { color: '#1d3b2a' },
    handler: verifyCheckoutPayment,
    modal: {
      ondismiss: () => {
        $('paymentStatus').textContent = 'Payment was not completed. Your cart is unchanged.';
      }
    }
  });
  checkout.on('payment.failed', response => {
    const message = response.error?.description || 'Payment failed. Please try again.';
    $('paymentStatus').textContent = message;
    showToast(message);
  });
  checkout.open();
}

$('paymentForm').addEventListener('submit', async event => {
  event.preventDefault();

  const requiredFields = [
    $('payName').value.trim(),
    $('payEmail').value.trim(),
    $('payAddress').value.trim(),
    $('payPhone').value.trim()
  ];

  if (requiredFields.some(field => !field)) {
    showToast('Please fill in all details');
    return;
  }

  const selectedMethod = getSelectedPaymentMethod();
  const submitButton = $('paymentSubmit');
  submitButton.disabled = true;
  submitButton.textContent = selectedMethod === 'cod'
    ? 'Placing COD order...'
    : selectedMethod === 'razorpay'
      ? 'Connecting to Razorpay...'
      : 'Generating UPI QR...';

  try {
    if (activePaymentOrder) return;
    const checkoutOrder = await api('/checkout/create-order', {
      method: 'POST',
      body: {
        items: Object.entries(cart).map(([id, qty]) => ({ id, qty })),
        customer: $('payName').value.trim(),
        email: $('payEmail').value.trim(),
        phone: $('payPhone').value.trim(),
        address: $('payAddress').value.trim(),
        paymentMethod: selectedMethod
      }
    });

    activePaymentOrder = checkoutOrder;
    $('qrMerchant').textContent = checkoutOrder.businessName;
    $('paymentReference').textContent = checkoutOrder.receipt;
    $('paymentSubmit').hidden = true;

    if (selectedMethod === 'cod') {
      cart = {};
      writeStorage('cart', cart);
      renderCart();
      if (localStorage.getItem('token')) renderOrders();
      $('paymentModal').hidden = true;
      $('paymentForm').reset();
      $('cart').hidden = false;
      $('cartMsg').className = 'msg ok';
      $('cartMsg').textContent = `Cash on delivery order placed: ${checkoutOrder.receipt}`;
      showToast('Order placed successfully');
      return;
    }

    if (checkoutOrder.qr) {
      $('paymentQr').src = checkoutOrder.qr.imageUrl;
      $('paymentQr').hidden = false;
      $('qrMerchant').textContent = checkoutOrder.businessName;
      const expiry = new Date(checkoutOrder.qr.expiresAt * 1000).toLocaleTimeString();
      $('paymentStatus').textContent = selectedMethod === 'upi_qr'
        ? `Scan with your UPI app. QR expires at ${expiry}. After paying, click below to confirm.`
        : `Scan with your UPI app. QR expires at ${expiry}. After paying, click below to confirm.`;
      $('checkQrPayment').hidden = false;
      $('checkoutFallback').hidden = selectedMethod !== 'razorpay';
    } else {
      $('paymentStatus').textContent = checkoutOrder.qrMessage || 'A QR is unavailable. Continue with Razorpay Checkout.';
      $('checkoutFallback').hidden = false;
    }
  } catch (error) {
    showToast(error.message);
    $('paymentStatus').textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = selectedMethod === 'cod'
      ? 'Place COD order'
      : selectedMethod === 'razorpay'
        ? 'Generate Razorpay order'
        : 'Generate UPI QR';
  }
});

$('checkQrPayment').onclick = async () => {
  if (!activePaymentOrder) return;
  const checkButton = $('checkQrPayment');
  checkButton.disabled = true;
  $('paymentStatus').textContent = 'Confirming your order...';
  try {
    cart = {};
    writeStorage('cart', cart);
    renderCart();
    if (localStorage.getItem('token')) renderOrders();
    $('paymentModal').hidden = true;
    $('paymentForm').reset();
    $('cart').hidden = false;
    $('cartMsg').className = 'msg ok';
    $('cartMsg').textContent = `Order confirmed. Reference: ${activePaymentOrder.receipt}`;
    showToast('Order confirmed');
  } catch (error) {
    $('paymentStatus').textContent = error.message;
    showToast(error.message);
  } finally {
    checkButton.disabled = false;
  }
};

$('checkoutFallback').onclick = () => {
  if (!window.Razorpay) {
    showToast('Razorpay Checkout did not load. Refresh the page and try again.');
    return;
  }
  if (activePaymentOrder) openRazorpayCheckout(activePaymentOrder);
};

$('ordersBtn').onclick = () => {
  renderOrders();
  $('ordersModal').hidden = false;
};

renderFilters();
renderCart();
renderAuth();
if (isGitHubPages) {
  $('deploymentNotice').hidden = false;
  $('authBtn').textContent = 'Sign-in unavailable';
  fetch('./products.json')
    .then(response => {
      if (!response.ok) throw new Error('Could not load the product catalogue.');
      return response.json();
    })
    .then(data => {
      products = data;
      renderProducts();
      renderCart();
    })
    .catch(error => {
      $('grid').innerHTML = `<p class="empty-state">${error.message}</p>`;
    });
} else {
  api('/products').then(data => {
    products = data;
    renderProducts();
    renderCart();
  }).catch(error => {
    $('grid').innerHTML = `<p class="empty-state">${error.message}</p>`;
  });
}