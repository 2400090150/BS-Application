const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let customer = null;
let addresses = [];
let editingAddressId = null;
let passwordResetWaiting = false;
let passwordResetPollTimer = null;
let passwordResetLocked = false;
let passwordResetEmail = '';
let passwordResetCreateNew = false;
let passwordResetHadActiveRequest = new URLSearchParams(location.search).get('password-reset') === 'required';
let accountReviewRating = 0;
const adminAccountView = document.createElement('section');
adminAccountView.id = 'adminAccountView';
adminAccountView.className = 'hidden';
$('authCard').append(adminAccountView);
const views = ['loginView', 'registerView', 'forgotView', 'accountView', 'adminAccountView'];

function showView(name) {
  views.forEach((view) => $(view).classList.toggle('hidden', view !== name));
  const accountPage = name === 'accountView' || name === 'adminAccountView';
  $('authCard').classList.toggle('account-card', accountPage);
  $('authCard').parentElement.classList.toggle('account-side', accountPage);
  document.title = name === 'adminAccountView'
    ? 'Administrator access · BS Handlooms'
    : (name === 'accountView' ? 'My Account · BS Handlooms' : 'Sign in · BS Handlooms');
  const titles = {
    loginView: ['YOUR BS HANDLOOMS ACCOUNT', 'Welcome back.', 'Sign in to continue your handloom journey.'],
    registerView: ['JOIN THE BS HANDLOOMS FAMILY', 'Create your account.', 'Save your details and keep track of your orders.'],
    forgotView: ['ACCOUNT RECOVERY', 'Reset your password.', 'Request administrator approval, then choose a new password.'],
    accountView: ['BS HANDLOOMS · MY ACCOUNT', 'My Account', 'Manage your personal details, delivery addresses and orders.'],
    adminAccountView: ['AUTHORIZED ADMINISTRATOR', 'Administrator access.', 'Manage the BS Handlooms store.']
  };
  const title = titles[name];
  $('formEyebrow').textContent = title[0];
  $('formTitle').textContent = title[1];
  $('formSubtitle').textContent = title[2];
}

function renderAdminAccount() {
  adminAccountView.innerHTML = `
    <div class="admin-account-card">
      <strong>Store administrator panel</strong>
      <p>Manage products and website images, review orders and view customer profiles and saved delivery addresses.</p>
      <a class="button button-dark full" href="/admin">Open administrator panel <span>↗</span></a>
    </div>
    <p class="auth-message" id="adminAccountMessage" role="status"></p>
    <button class="button button-outline full sign-out-button" id="logoutAdmin" type="button">Sign out</button>`;
  showView('adminAccountView');
  $('logoutAdmin').addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', {});
      window.location.assign('/');
    } catch (error) {
      message('adminAccountMessage', error.message);
    }
  });
}

async function loadAuthSiteImage() {
  try {
    const response = await fetch('/api/site-images');
    if (!response.ok) throw new Error('Could not load site images.');
    const images = await response.json();
    const heroKey = location.pathname === '/profile' ? 'account-hero' : 'login-hero';
    const hero = images.find((item) => item.key === heroKey);
    const visual = document.querySelector('.auth-visual');
    if (hero && visual) {
      visual.style.backgroundImage = `linear-gradient(180deg,rgba(24,22,16,.25),rgba(24,22,16,.82)),url(${JSON.stringify(hero.image)})`;
    }
  } catch (error) {
    console.error(error);
  }
}

async function api(url, body, method = 'POST') {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin'
  });
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    const restartMessage = `The server returned an unexpected response (HTTP ${response.status}). Restart the BS Handlooms server and try again.`;
    throw new Error(restartMessage);
  }
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed.');
  return data;
}

function message(id, text, success = false) {
  const element = $(id);
  element.textContent = text;
  element.classList.toggle('success', success);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function redirectToStore() {
  window.location.assign('/');
}

function openPasswordResetForm() {
  stopPasswordResetPolling();
  $('passwordResetRequestForm').reset();
  $('passwordResetForm').reset();
  $('passwordResetRequestForm').classList.remove('hidden');
  $('passwordResetPendingMessage').classList.add('hidden');
  $('passwordResetForm').classList.add('hidden');
  message('passwordResetRequestMessage', '');
  message('passwordResetPendingMessage', '');
  message('passwordResetMessage', '');
  $('passwordResetRequestButton').innerHTML = 'Send Request <span>↗</span>';
  passwordResetCreateNew = false;
  showView('forgotView');
  const loginEmail = $('loginForm').elements.identifier.value.trim();
  if (/^[a-z0-9._%+-]+@gmail\.com$/i.test(loginEmail)) {
    $('passwordResetRequestForm').elements.email.value = loginEmail;
  }
  $('passwordResetRequestForm').elements.email.focus();
}

function stopPasswordResetPolling() {
  passwordResetWaiting = false;
  if (passwordResetPollTimer) window.clearTimeout(passwordResetPollTimer);
  passwordResetPollTimer = null;
}

function setPasswordResetLock(locked) {
  passwordResetLocked = locked;
  document.documentElement.classList.toggle('password-reset-required', locked);
  document.documentElement.classList.toggle('password-reset-ready', locked);
  $('backToLogin').classList.toggle('hidden', locked);
}

async function checkPasswordResetApproval() {
  if (!passwordResetWaiting) return;
  try {
    const result = await api(`/api/auth/password-reset/status?email=${encodeURIComponent(passwordResetEmail)}`, undefined, 'GET');
    if (result.status === 'APPROVED') {
      stopPasswordResetPolling();
      setPasswordResetLock(true);
      $('passwordResetRequestForm').classList.add('hidden');
      $('passwordResetPendingMessage').classList.add('hidden');
      $('passwordResetForm').classList.remove('hidden');
      $('passwordResetApprovedEmail').textContent = `Approved for ${passwordResetEmail}`;
      message('passwordResetMessage', 'Your request was approved. Create and confirm your new password.', true);
      $('passwordResetForm').elements.password.focus();
      return;
    }
    if (result.status === 'REJECTED') {
      stopPasswordResetPolling();
      $('passwordResetRequestForm').classList.remove('hidden');
      $('passwordResetPendingMessage').classList.add('hidden');
      $('passwordResetRequestButton').innerHTML = 'Send New Request <span>↗</span>';
      passwordResetCreateNew = true;
      setPasswordResetLock(true);
      message('passwordResetRequestMessage', 'Your password reset request was rejected. You can submit a new request.');
      return;
    }
    if (result.status === 'USED') {
      stopPasswordResetPolling();
      setPasswordResetLock(false);
      $('passwordResetPendingMessage').classList.add('hidden');
      $('passwordResetForm').classList.add('hidden');
      showView('loginView');
      message('loginMessage', 'Password updated successfully. Please sign in.', true);
      return;
    }
    if (result.status === 'NONE') {
      stopPasswordResetPolling();
      $('passwordResetPendingMessage').classList.add('hidden');
      $('passwordResetRequestForm').classList.remove('hidden');
      if (passwordResetHadActiveRequest) {
        setPasswordResetLock(true);
        message('passwordResetRequestMessage', 'We could not confirm a request for this Gmail in this browser. Check the address and try again.');
      } else {
        setPasswordResetLock(false);
        message('passwordResetRequestMessage', 'If an account matches this address, the request will be reviewed.');
      }
      return;
    }
    passwordResetHadActiveRequest = true;
    setPasswordResetLock(true);
    $('passwordResetRequestForm').classList.add('hidden');
    $('passwordResetPendingMessage').classList.remove('hidden');
    message('passwordResetPendingMessage', 'Your request is awaiting admin approval.');
  } catch (error) {
    message('passwordResetPendingMessage', `Could not check the request status: ${error.message}`);
  }
  if (passwordResetWaiting) {
    passwordResetPollTimer = window.setTimeout(checkPasswordResetApproval, 5000);
  }
}

function restorePasswordResetRequest() {
  passwordResetHadActiveRequest = true;
  setPasswordResetLock(true);
  showView('forgotView');
  $('passwordResetRequestForm').classList.remove('hidden');
  $('passwordResetPendingMessage').classList.add('hidden');
  $('passwordResetForm').classList.add('hidden');
  message('passwordResetRequestMessage', 'Enter the Gmail address you used for the request to check its status.');
}

function setProfileEditing(editing) {
  const form = $('profileForm');
  ['name', 'phone', 'address'].forEach((name) => {
    form.elements[name].disabled = !editing;
  });
  $('editProfile').classList.toggle('hidden', editing);
  $('saveProfile').classList.toggle('hidden', !editing);
  $('cancelProfile').classList.toggle('hidden', !editing);
  $('profileDetails').classList.toggle('hidden', editing);
  form.classList.toggle('hidden', !editing);
  if (editing) form.elements.name.focus();
}

function fillProfile(profile) {
  const form = $('profileForm');
  form.elements.name.value = profile.name || '';
  form.elements.phone.value = profile.phone || '';
  form.elements.address.value = profile.address || '';
}

function displayValue(value) {
  return String(value || '').trim() || 'Not added yet';
}

function formatAccountDate(value) {
  if (!value) return 'Not added yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not added yet' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatOrderDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderProfileDetails(profile) {
  $('profileName').textContent = displayValue(profile.name);
  $('profileUsername').textContent = displayValue(profile.username);
  $('profileEmail').textContent = displayValue(profile.email);
  $('profilePhone').textContent = displayValue(profile.phone);
  $('profileCreated').textContent = formatAccountDate(profile.created_at);
}

function addressPayload(form) {
  const data = new FormData(form);
  return {
    recipient_name: data.get('recipient_name').trim(),
    phone: data.get('phone').trim(),
    house: data.get('house').trim(),
    street: data.get('street').trim(),
    city: data.get('city').trim(),
    state: data.get('state').trim(),
    pin_code: data.get('pin_code').trim(),
    country: String(data.get('country') || '').trim(),
    landmark: data.get('landmark').trim(),
    label: data.get('label'),
    is_default: data.has('is_default')
  };
}

function renderAddresses() {
  const container = $('addressesContainer');
  const hasSavedDefault = addresses.some((address) => Boolean(Number(address.is_default) || address.is_default === true));
  const additionalCount = Math.max(0, addresses.length - Number(hasSavedDefault));
  const primary = addresses.find((address) => Boolean(Number(address.is_default) || address.is_default === true));
  const legacyAddress = String(customer?.address || '').trim();
  $('addressCount').textContent = additionalCount >= 4
    ? '4 of 4 additional addresses saved — limit reached.'
    : `${additionalCount} of 4 additional addresses saved`;
  const atLimit = additionalCount >= 4 && editingAddressId === null;
  $('addAddress').disabled = atLimit;
  $('addAddress').title = atLimit ? 'You can save up to four additional addresses.' : '';
  const primaryContainer = $('primaryAddressContainer');
  if (primary) {
    $('addPrimaryAddress').classList.add('hidden');
    primaryContainer.innerHTML = `<article class="primary-address-card">
      <div class="primary-address-heading"><span class="default-badge">Primary address</span><strong>${escapeHtml(displayValue(primary.recipient_name))}</strong></div>
      <dl class="address-details-grid">
        <div><dt>Address line</dt><dd>${escapeHtml(displayValue([primary.house, primary.street].filter(Boolean).join(', ')))}</dd></div>
        <div><dt>City name</dt><dd>${escapeHtml(displayValue(primary.city))}</dd></div>
        <div><dt>State</dt><dd>${escapeHtml(displayValue(primary.state))}</dd></div>
        <div><dt>Pincode</dt><dd>${escapeHtml(displayValue(primary.pin_code))}</dd></div>
        <div><dt>Country</dt><dd>${escapeHtml(displayValue(primary.country || 'India'))}</dd></div>
        <div><dt>Contact number</dt><dd>${escapeHtml(displayValue(primary.phone))}</dd></div>
      </dl>
      <div class="address-actions" id="primaryAddressActions">
        <button class="inline-link" type="button" data-address-action="edit" data-address-id="${encodeURIComponent(String(primary.id))}">Edit</button>
        <button class="inline-link address-delete" type="button" data-address-action="delete" data-address-id="${encodeURIComponent(String(primary.id))}">Delete</button>
      </div>
    </article>`;
  } else if (legacyAddress) {
    $('addPrimaryAddress').classList.remove('hidden');
    primaryContainer.innerHTML = `<article class="primary-address-card">
      <span class="default-badge">Primary address</span>
      <dl class="address-details-grid">
        <div><dt>Address line</dt><dd>${escapeHtml(legacyAddress)}</dd></div>
        <div><dt>City name</dt><dd>Not added yet</dd></div><div><dt>State</dt><dd>Not added yet</dd></div>
        <div><dt>Pincode</dt><dd>Not added yet</dd></div><div><dt>Country</dt><dd>India</dd></div>
      </dl>
    </article>`;
  } else {
    $('addPrimaryAddress').classList.remove('hidden');
    primaryContainer.innerHTML = '<p class="muted empty-addresses">Not added yet. Add your primary delivery address to complete your account.</p>';
  }
  const additionalAddresses = addresses.filter((address) => !Boolean(Number(address.is_default) || address.is_default === true));
  if (!additionalAddresses.length) {
    container.innerHTML = '<p class="muted empty-addresses">No additional addresses saved yet.</p>';
    return;
  }
  container.innerHTML = additionalAddresses.map((address) => {
    const id = encodeURIComponent(String(address.id));
    const streetAddress = [address.house, address.street].filter((part) => String(part || '').trim()).map(escapeHtml).join(', ');
    const cityAddress = [address.city, address.state, address.pin_code, address.country || 'India'].filter((part) => String(part || '').trim()).map(escapeHtml).join(', ');
    return `<article class="saved-address">
      <div class="saved-address-copy">
        <div class="saved-address-title"><strong>${escapeHtml(displayValue(address.recipient_name))}</strong><span class="address-label">${escapeHtml(address.label || 'Other')}</span></div>
        <p>${streetAddress || 'Not added yet'}${streetAddress && cityAddress ? '<br>' : ''}${cityAddress || 'Not added yet'}</p>
        ${address.landmark ? `<p class="address-detail">Landmark: ${escapeHtml(address.landmark)}</p>` : ''}
        <p class="address-detail">${escapeHtml(displayValue(address.phone))}</p>
      </div>
      <div class="address-actions">
        <button class="inline-link" type="button" data-address-action="default" data-address-id="${id}">Set as primary</button>
        <button class="inline-link" type="button" data-address-action="edit" data-address-id="${id}">Edit</button>
        <button class="inline-link address-delete" type="button" data-address-action="delete" data-address-id="${id}">Delete</button>
      </div>
    </article>`;
  }).join('');
}

async function loadAddresses() {
  $('addAddress').disabled = true;
  $('addressesContainer').innerHTML = '<p class="muted">Loading your addresses…</p>';
  $('addressCount').textContent = 'Loading your addresses…';
  try {
    const result = await api('/api/auth/addresses', undefined, 'GET');
    addresses = Array.isArray(result.addresses) ? result.addresses : [];
    renderAddresses();
  } catch (error) {
    addresses = [];
    $('addressCount').textContent = '';
    $('primaryAddressContainer').innerHTML = `<p class="auth-message">${escapeHtml(error.message || 'Could not load your address.')}</p>`;
    $('addressesContainer').innerHTML = `<p class="auth-message">${escapeHtml(error.message || 'Could not load your addresses.')}</p><button class="inline-link" id="retryAddresses" type="button">Try again</button>`;
  }
}

function openAddressForm(address = null) {
  const form = $('addressForm');
  editingAddressId = address ? address.id : null;
  form.reset();
  if (address) {
    Object.keys(addressPayload(form)).forEach((key) => {
      if (key === 'is_default') form.elements[key].checked = Boolean(Number(address[key]) || address[key] === true);
      else if (form.elements[key]) form.elements[key].value = address[key] || '';
    });
  } else {
    form.elements.label.value = 'Home';
    form.elements.country.value = 'India';
  }
  $('addressFormTitle').textContent = address ? 'Edit delivery address' : 'Add a delivery address';
  $('saveAddress').textContent = address ? 'Save changes' : 'Save address';
  form.classList.remove('hidden');
  $('addAddress').classList.add('hidden');
  message('addressMessage', '');
  form.elements.recipient_name.focus();
}

function closeAddressForm() {
  $('addressForm').classList.add('hidden');
  $('addAddress').classList.remove('hidden');
  $('addressForm').reset();
  editingAddressId = null;
}

async function renderAccount(profile) {
  customer = profile;
  showView('accountView');
  $('openAdminPortal').classList.toggle('hidden', profile.hasAdminAccess !== true);
  $('accountGreeting').textContent = `Namaste, ${profile.name || 'there'}.`;
  renderProfileDetails(profile);
  fillProfile(profile);
  setProfileEditing(false);
  message('profileMessage', '');
  $('ordersContainer').innerHTML = '<p class="muted">Loading your orders…</p>';
  await Promise.all([loadAddresses(), loadOrders(), loadCustomerReviews()]);
}

async function loadCustomerReviews() {
  const container = $('accountReviews');
  if (!container) return;
  try {
    const response = await fetch('/api/auth/reviews', { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your reviews.');
    if (!result.reviews.length) {
      container.innerHTML = '<p class="muted">You have not submitted a review yet.</p>';
      return;
    }
    container.innerHTML = result.reviews.map((review) => `
      <article class="customer-review-card">
        <div class="customer-review-heading">
          <span class="rating" aria-label="${review.rating} out of 5 stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span>
          <span class="review-status review-status-${escapeHtml(review.status)}">${escapeHtml(review.status)}</span>
        </div>
        <p>${escapeHtml(review.description)}</p>
        <small>${escapeHtml(formatAccountDate(review.created_at))}</small>
      </article>
    `).join('');
  } catch (error) {
    container.innerHTML = `<p class="auth-message">${escapeHtml(error.message)}</p>`;
  }
}

$$('[data-review-rating]').forEach((button) => {
  button.addEventListener('click', () => {
    accountReviewRating = Number(button.dataset.reviewRating);
    $$('[data-review-rating]').forEach((star) => {
      const selected = Number(star.dataset.reviewRating) <= accountReviewRating;
      star.classList.toggle('selected', selected);
      star.setAttribute('aria-checked', Number(star.dataset.reviewRating) === accountReviewRating ? 'true' : 'false');
    });
  });
});

$('accountReviewForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const messageElement = $('accountReviewMessage');
  const submitButton = form.querySelector('[type="submit"]');
  messageElement.textContent = '';
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ rating: accountReviewRating, description: form.elements.description.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not submit your review.');
    form.reset();
    accountReviewRating = 0;
    $$('[data-review-rating]').forEach((star) => {
      star.classList.remove('selected');
      star.setAttribute('aria-checked', 'false');
    });
    messageElement.textContent = result.message;
    messageElement.classList.add('success');
    await loadCustomerReviews();
  } catch (error) {
    messageElement.textContent = error.message;
    messageElement.classList.remove('success');
  } finally {
    submitButton.disabled = false;
  }
});

async function loadOrders() {
  try {
    const response = await fetch('/api/auth/orders', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load orders.');
    const result = await response.json();
    const orders = Array.isArray(result) ? result : (result.orders || []);
    const container = $('ordersContainer');
    if (!orders.length) {
      container.innerHTML = '<p class="muted">No orders yet. Your next handloom favourite is waiting.</p>';
      return;
    }
    const orderStatuses = ['New', 'Confirmed', 'Packed', 'Shipped', 'Delivered'];
    container.innerHTML = orders.map((order) => {
      const updates = Array.isArray(order.status_updates) ? order.status_updates : [];
      const updateByStatus = new Map(updates.map((update) => [update.status, update]));
      const currentIndex = orderStatuses.indexOf(order.status);
      const timeline = order.status === 'Cancelled'
        ? `<p class="order-cancelled-status">Cancelled${order.cancellation_date ? ` · ${escapeHtml(formatOrderDate(order.cancellation_date))}` : ''}</p>`
        : `<ol class="order-timeline" aria-label="Order status timeline">${orderStatuses.map((status, index) => {
          const update = updateByStatus.get(status);
          const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : '';
          return `<li class="${state}"><span class="order-timeline-dot" aria-hidden="true"></span><span class="order-timeline-copy"><strong>${escapeHtml(status === 'New' ? 'Order placed' : status)}</strong>${update?.created_at ? `<small>${escapeHtml(formatOrderDate(update.created_at))}</small>` : ''}${update?.note && index === currentIndex ? `<small>${escapeHtml(update.note)}</small>` : ''}</span></li>`;
        }).join('')}</ol>`;
      const canCancel = order.status === 'New';
      return `<article class="order-card">
        <header><strong>Order #${escapeHtml(order.id)}</strong><strong>₹${Number(order.total).toLocaleString('en-IN')}</strong></header>
        <p>${escapeHtml(formatOrderDate(order.created_at) || 'Order date unavailable')} · Payment: ${escapeHtml(order.payment_status)}</p>
        <p class="order-items">${(order.items || []).map((item) => `${escapeHtml(item.name)} × ${escapeHtml(item.quantity)}`).join(', ')}</p>
        ${timeline}
        ${order.status === 'Cancelled' && order.cancellation_reason ? `<p class="order-cancellation-note">${escapeHtml(order.cancellation_reason)}</p>` : ''}
        ${canCancel ? `<button class="button button-outline order-cancel-button" type="button" data-cancel-order="${escapeHtml(order.id)}">Cancel order</button>` : ''}
        <p class="auth-message" data-order-message="${escapeHtml(order.id)}" role="status" aria-live="polite"></p>
      </article>`;
    }).join('');
  } catch {
    $('ordersContainer').innerHTML = '<p class="muted">Could not load orders right now.</p>';
  }
}

$('ordersContainer').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-cancel-order]');
  if (!button) return;
  if (!window.confirm('Cancel this order? Orders can only be cancelled before the admin confirms them. Delivered products cannot be returned.')) return;
  const orderId = button.dataset.cancelOrder;
  button.disabled = true;
  try {
    await api(`/api/auth/orders/${encodeURIComponent(orderId)}/cancel`, {}, 'PATCH');
    await loadOrders();
  } catch (error) {
    const messageElement = button.closest('.order-card')?.querySelector('[data-order-message]');
    if (messageElement) messageElement.textContent = error.message;
    button.disabled = false;
  }
});

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (passwordResetLocked) {
    showView('forgotView');
    message('passwordResetMessage', 'Complete your administrator-approved password reset before signing in.');
    return;
  }
  message('loginMessage', '');
  const data = new FormData(event.currentTarget);
  try {
    await api('/api/auth/login', { identifier: data.get('identifier'), password: data.get('password') });
    redirectToStore();
  } catch (error) {
    message('loginMessage', error.message);
  }
});

$('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('registerMessage', '');
  const data = new FormData(event.currentTarget);
  if (data.get('password') !== data.get('confirm')) return message('registerMessage', 'Passwords do not match.');
  try {
    await api('/api/auth/register', {
      name: data.get('name'),
      username: data.get('username'),
      email: data.get('email'),
      password: data.get('password'),
      confirmPassword: data.get('confirm'),
      phone: data.get('phone'),
      address: data.get('address')
    });
    redirectToStore();
  } catch (error) {
    message('registerMessage', error.message);
  }
});

$('passwordResetRequestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = $('passwordResetRequestButton');
  passwordResetEmail = form.elements.email.value.trim().toLowerCase();
  message('passwordResetRequestMessage', '');
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const result = await api('/api/auth/password-reset/request', {
      email: passwordResetEmail,
      newRequest: passwordResetCreateNew
    });
    setPasswordResetLock(true);
    $('passwordResetForm').classList.add('hidden');
    $('passwordResetPendingMessage').classList.remove('hidden');
    passwordResetWaiting = true;
    message('passwordResetPendingMessage', result.message, true);
    await checkPasswordResetApproval();
  } catch (error) {
    message('passwordResetRequestMessage', error.message);
  } finally {
    button.disabled = false;
    if (!passwordResetWaiting && !passwordResetCreateNew)
      button.innerHTML = 'Send Request <span>↗</span>';
    else if (passwordResetCreateNew)
      button.innerHTML = 'Send New Request <span>↗</span>';
  }
});

$('passwordResetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  message('passwordResetMessage', '');
  if (data.get('password') !== data.get('confirmPassword')) {
    message('passwordResetMessage', 'Passwords do not match.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await api('/api/auth/password-reset/complete', {
      email: passwordResetEmail,
      password: data.get('password'),
      confirmPassword: data.get('confirmPassword')
    });
    message('passwordResetMessage', result.message, true);
    window.setTimeout(() => window.location.assign('/login?password-reset=success'), 1200);
  } catch (error) {
    message('passwordResetMessage', error.message);
    button.disabled = false;
    button.innerHTML = 'Save Password <span>↗</span>';
  } finally {
    if (!button.disabled) button.innerHTML = 'Save Password <span>↗</span>';
  }
});

$('editProfile').addEventListener('click', () => {
  message('profileMessage', '');
  setProfileEditing(true);
});
$('cancelProfile').addEventListener('click', () => {
  fillProfile(customer || {});
  setProfileEditing(false);
  message('profileMessage', '');
});

$('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const form = event.currentTarget;
  const submitButton = $('saveProfile');
  submitButton.disabled = true;
  message('profileMessage', '');
  const data = new FormData(form);
  try {
    const result = await api('/api/auth/profile', {
      name: data.get('name').trim(),
      phone: data.get('phone').trim(),
      address: data.get('address')?.trim()
    }, 'PATCH');
    customer = result.customer;
    $('accountGreeting').textContent = `Namaste, ${customer.name || 'there'}.`;
    renderProfileDetails(customer);
    fillProfile(customer);
    setProfileEditing(false);
    message('profileMessage', 'Your profile has been saved.', true);
  } catch (error) {
    message('profileMessage', error.message);
  } finally {
    submitButton.disabled = false;
  }
});

$('addAddress').addEventListener('click', () => {
  const hasSavedDefault = addresses.some((address) => Boolean(Number(address.is_default) || address.is_default === true));
  if (addresses.length - Number(hasSavedDefault) >= 4) return message('addressMessage', 'You can save up to four additional addresses.');
  openAddressForm();
});
$('addPrimaryAddress').addEventListener('click', () => {
  openAddressForm();
  $('addressForm').elements.is_default.checked = true;
});
$('cancelAddress').addEventListener('click', closeAddressForm);
$('addressForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const saveButton = $('saveAddress');
  saveButton.disabled = true;
  message('addressMessage', '');
  try {
    const path = editingAddressId === null ? '/api/auth/addresses' : `/api/auth/addresses/${encodeURIComponent(editingAddressId)}`;
    await api(path, addressPayload(form), editingAddressId === null ? 'POST' : 'PATCH');
    closeAddressForm();
    message('addressMessage', 'Address saved successfully.', true);
    await loadAddresses();
  } catch (error) {
    message('addressMessage', error.message);
  } finally {
    saveButton.disabled = false;
  }
});

async function handleAddressAction(event) {
  const retry = event.target.closest('#retryAddresses');
  if (retry) return loadAddresses();
  const button = event.target.closest('[data-address-action]');
  if (!button) return;
  const address = addresses.find((item) => String(item.id) === decodeURIComponent(button.dataset.addressId));
  if (!address) return;
  const action = button.dataset.addressAction;
  if (action === 'edit') return openAddressForm(address);
  if (action === 'delete' && !window.confirm('Delete this saved address?')) return;
  button.disabled = true;
  message('addressMessage', '');
  try {
    if (action === 'delete') {
      const result = await api(`/api/auth/addresses/${encodeURIComponent(address.id)}`, undefined, 'DELETE');
      if (Boolean(Number(address.is_default) || address.is_default === true)) {
        const nextPrimary = result.addresses.find((item) => Boolean(Number(item.is_default) || item.is_default === true));
        customer.address = nextPrimary
          ? [nextPrimary.house, nextPrimary.street, nextPrimary.landmark, nextPrimary.city, nextPrimary.state, nextPrimary.pin_code, nextPrimary.country]
            .map((part) => String(part || '').trim()).filter(Boolean).join(', ')
          : '';
      }
      message('addressMessage', result.message || 'Address deleted.', true);
    } else {
      const result = await api(`/api/auth/addresses/${encodeURIComponent(address.id)}/default`, {}, 'PATCH');
      const primary = result.addresses.find((item) => Boolean(Number(item.is_default) || item.is_default === true));
      if (primary) {
        customer.address = [primary.house, primary.street, primary.landmark, primary.city, primary.state, primary.pin_code, primary.country]
          .map((part) => String(part || '').trim()).filter(Boolean).join(', ');
      }
      message('addressMessage', 'Default address updated.', true);
    }
    await loadAddresses();
  } catch (error) {
    message('addressMessage', error.message);
    button.disabled = false;
  }
}

$('addressesContainer').addEventListener('click', handleAddressAction);
$('primaryAddressContainer').addEventListener('click', handleAddressAction);

$('changePasswordToggle').addEventListener('click', () => {
  $('changePasswordForm').classList.remove('hidden');
  $('changePasswordToggle').classList.add('hidden');
  message('passwordMessage', '');
  $('changePasswordForm').elements.currentPassword.focus();
});
$('cancelPassword').addEventListener('click', () => {
  $('changePasswordForm').reset();
  $('changePasswordForm').classList.add('hidden');
  $('changePasswordToggle').classList.remove('hidden');
  message('passwordMessage', '');
});
$('changePasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const button = $('savePassword');
  button.disabled = true;
  message('passwordMessage', '');
  try {
    const result = await api('/api/auth/password', {
      currentPassword: data.get('currentPassword'),
      password: data.get('password'),
      confirmPassword: data.get('confirmPassword')
    }, 'PATCH');
    form.reset();
    form.classList.add('hidden');
    $('changePasswordToggle').classList.remove('hidden');
    message('passwordMessage', result.message, true);
  } catch (error) {
    message('passwordMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('logoutCustomer').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', {});
    window.location.assign('/login');
  } catch {
    window.location.reload();
  }
});

$('openAdminPortal').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  message('profileMessage', '');
  try {
    await api('/api/auth/admin-session', {});
    window.location.assign('/admin');
  } catch (error) {
    message('profileMessage', error.message);
    button.disabled = false;
  }
});

$('showRegister').addEventListener('click', () => {
  if (!passwordResetLocked) showView('registerView');
});
$('showLogin').addEventListener('click', () => {
  if (!passwordResetLocked) showView('loginView');
});
$('forgotLink').addEventListener('click', openPasswordResetForm);
$('backToLogin').addEventListener('click', () => {
  if (passwordResetLocked) return;
  stopPasswordResetPolling();
  $('passwordResetRequestForm').reset();
  $('passwordResetForm').reset();
  $('passwordResetRequestForm').classList.remove('hidden');
  $('passwordResetPendingMessage').classList.add('hidden');
  $('passwordResetForm').classList.add('hidden');
  message('passwordResetRequestMessage', '');
  message('passwordResetPendingMessage', '');
  message('passwordResetMessage', '');
  showView('loginView');
});
document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} password`);
    button.title = `${show ? 'Hide' : 'Show'} password`;
    button.setAttribute('aria-pressed', String(show));
    button.querySelector('.password-eye')?.classList.toggle('hidden', show);
    button.querySelector('.password-eye-off')?.classList.toggle('hidden', !show);
  });
});

(async () => {
  const profileRoute = location.pathname === '/profile';
  if (profileRoute) document.documentElement.classList.add('profile-checking');
  if (new URLSearchParams(location.search).get('password-reset') === 'success') {
    message('loginMessage', 'Password updated successfully. Please log in.', true);
    window.history.replaceState({}, document.title, '/login');
  } else if (new URLSearchParams(location.search).get('password-reset') === 'change') {
    openPasswordResetForm();
    window.history.replaceState({}, document.title, '/login');
  }
  try {
    await loadAuthSiteImage();
    if (profileRoute) {
      const adminResponse = await fetch('/api/admin/me', { credentials: 'same-origin' });
      if (!adminResponse.ok) throw new Error('Could not check your account session.');
      const adminStatus = await adminResponse.json();
      if (adminStatus.authenticated) {
        renderAdminAccount();
        return;
      }
    }
    if (!profileRoute && passwordResetHadActiveRequest) {
      restorePasswordResetRequest();
      return;
    }
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load your account.');
    const result = await response.json();
    if (result.authenticated && result.customer) await renderAccount(result.customer);
  } catch {
    if (profileRoute) message('loginMessage', 'Could not load your account. Refresh the page to try again.');
  } finally {
    if (profileRoute) document.documentElement.classList.remove('profile-checking');
  }
  if (new URLSearchParams(location.search).get('mode') === 'register') showView('registerView');
})();
