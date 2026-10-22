const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
}).format(Number(value || 0));

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
    ...options
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {}

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

function toast(message) {
  const toastElement = $('#adminToast');
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(window.adminToastTimer);
  window.adminToastTimer = setTimeout(() => toastElement.classList.remove('show'), 2500);
}

let products = [];
let categories = [];
let collectionItems = [];
let banners = [];
let offers = [];
let customers = [];
let siteImages = [];
let siteImageLibrary = [];
let siteImageDriveConfig = {};
let currentOfferBanners = {};
let currentAdmin = null;
let observedPasswordResetRequestIds = new Set();
let hasLoadedPasswordResetNotifications = false;

function formatIST(value) {
  if (!value) return '—';
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')} IST`;
}

function updateAdminClock() {
  const clock = $('#adminClock');
  if (clock) clock.textContent = `Current time (IST): ${formatIST(new Date().toISOString())}`;
}

async function boot() {
  try {
    const status = await api('/api/admin/me');
    if (status.authenticated) {
      await showDashboard();
      return;
    }
  } catch (error) {}
  showLogin();
  try {
    const status = await api('/api/admin/owner-setup/status');
    $('#showOwnerSetup')?.classList.toggle('hidden', !status.available);
    const emailField = $('#ownerSetupForm [name="email"]');
    if (emailField) emailField.value = status.mainAdminEmail || '';
  } catch (error) {
    console.error('Could not load initial owner setup status:', error);
  }
}

function showLogin() {
  currentAdmin = null;
  if (window.passwordResetNotificationInterval) {
    clearInterval(window.passwordResetNotificationInterval);
    window.passwordResetNotificationInterval = null;
  }
  const loginPanel = $('#loginPanel');
  const dashboard = $('#dashboard');
  if (loginPanel) loginPanel.classList.remove('hidden');
  if (dashboard) dashboard.classList.add('hidden');
  $('#ownerSetupPanel')?.classList.add('hidden');
}

async function showDashboard() {
  currentAdmin = await api('/api/admin/me');
  if (!currentAdmin.authenticated) {
    currentAdmin = null;
    showLogin();
    return;
  }
  const loginPanel = $('#loginPanel');
  const dashboard = $('#dashboard');
  if (loginPanel) loginPanel.classList.add('hidden');
  $('#ownerSetupPanel')?.classList.add('hidden');
  if (dashboard) dashboard.classList.remove('hidden');
  const owner = currentAdmin.isMainAdmin === true;
  $('#adminIdentity').textContent = `${currentAdmin.email} · ${owner ? 'Main Admin / Owner' : 'Admin'}`;
  $('#adminAccessTab')?.classList.toggle('hidden', !owner);
  $('#adminAccessPanel')?.classList.toggle('hidden', !owner);
  $('#contactSettingsTab')?.classList.toggle('hidden', !owner);
  $('#orderDataTab')?.classList.toggle('hidden', !owner);
  $('#orderDataPanel')?.classList.toggle('hidden', !owner);
  updateAdminClock();
  if (!window.adminClockInterval) window.adminClockInterval = setInterval(updateAdminClock, 1000);

  await Promise.all([
    loadSummary(),
    loadProducts(),
    loadCategories(),
    loadCollections(),
    loadBanners(),
    loadOffers(),
    loadOrders(),
    loadCustomers(),
    loadSiteImages(),
    loadOfferBanners(),
    loadAdminReviews(),
    loadAdminContact()
  ]);
  await refreshPasswordResetNotifications();
  if (!window.passwordResetNotificationInterval) {
    window.passwordResetNotificationInterval = setInterval(() => {
      if (!currentAdmin) {
        clearInterval(window.passwordResetNotificationInterval);
        window.passwordResetNotificationInterval = null;
        return;
      }
      refreshPasswordResetNotifications().catch((error) => console.error('Could not refresh password-reset notifications:', error));
    }, 15000);
  }
  if (owner) await Promise.all([loadAdminAccess(), loadOrderDataAudit()]);
}

$('#loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  $('#loginError').textContent = '';

  try {
    const formData = new FormData(form);
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });

    form.reset();
    await showDashboard();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

$('#showOwnerSetup')?.addEventListener('click', () => {
  $('#loginPanel')?.classList.add('hidden');
  $('#ownerSetupPanel')?.classList.remove('hidden');
});

$('#backToAdminLogin')?.addEventListener('click', showLogin);

$('#ownerSetupForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  $('#ownerSetupError').textContent = '';
  const values = new FormData(form);
  try {
    await api('/api/admin/owner-setup', {
      method: 'POST',
      body: JSON.stringify({
        email: values.get('email'),
        password: values.get('password'),
        setupToken: values.get('setupToken')
      })
    });
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') })
    });
    form.reset();
    toast('Main Admin setup complete.');
    await showDashboard();
  } catch (error) {
    $('#ownerSetupError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logoutButton')?.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
    toast('Signed out.');
  } catch (error) {
    toast(error.message);
  }
});

async function loadSummary() {
  const summary = await api('/api/admin/summary');
  $('#statProducts').textContent = summary.products;
  $('#statOrders').textContent = summary.orders;
  $('#statRevenue').textContent = money(summary.revenue || 0);
  $('#statPending').textContent = summary.pending || 0;
}

function populateProductSelects() {
  const collectionSelect = $('#collectionForm select[name="product_id"]');
  const offerSelect = $('#offerForm select[name="product_id"]');
  const options = ["<option value=''>Select a product</option>"].concat(
    products.map((product) => `<option value="${product.id}">${safe(product.name)} (${safe(product.category)})</option>`)
  );

  if (collectionSelect) collectionSelect.innerHTML = options.join('');
  if (offerSelect) offerSelect.innerHTML = options.join('');
}

async function loadProducts() {
  products = await api('/api/admin/products');
  const selectedHomeShopCount = products.filter((product) => product.homepage_shop).length;
  const selectionCount = $('#homeShopSelectionCount');
  if (selectionCount) selectionCount.textContent = `${selectedHomeShopCount} of 8 selected`;
  const table = $('#productsTable');
  if (table) {
    table.innerHTML = products.length
      ? products.map((product) => `
        <tr>
          <td><img src="${safe(product.image)}" alt="${safe(product.name)}"><span class="prod-name">${safe(product.name)}</span></td>
          <td>${safe(product.category)}</td>
          <td>${Number(product.discountPercent) > 0
            ? `<del>${money(product.price)}</del><br><strong>${money(product.selling_price)}</strong> <span class="discount-label">${Number(product.discountPercent)}% OFF</span>`
            : money(product.price)}</td>
          <td>${product.stock}</td>
          <td>
            <button type="button" class="status-tag ${product.active ? '' : 'off'}" data-visibility="${product.id}" data-active="${!product.active}" aria-label="${product.active ? 'Hide' : 'Show'} ${safe(product.name)}" title="${product.active ? 'Click to hide this product' : 'Click to show this product'}">${product.active ? 'Visible' : 'Hidden'}</button>
            ${product.stock < 1
              ? `<button type="button" class="status-tag off" data-edit-stock="${product.id}" aria-label="Add stock for ${safe(product.name)}" title="Click to add stock">Out of stock</button>`
              : `<button type="button" class="status-tag ${product.out_of_stock ? 'off' : ''}" data-availability="${product.id}" data-out-of-stock="${!product.out_of_stock}" aria-label="${product.out_of_stock ? 'Mark in stock' : 'Mark out of stock'}: ${safe(product.name)}" title="Click to change availability">${product.out_of_stock ? 'Out of stock' : 'In stock'}</button>`}
          </td>
          <td><button type="button" class="table-action" data-homepage-shop="${product.id}" data-selected="${!!product.homepage_shop}" ${!product.homepage_shop && (!product.active || !product.category_active || selectedHomeShopCount >= 8) ? `disabled title="${!product.active || !product.category_active ? 'Product and category must be active' : 'Remove a selected product before adding another'}"` : ''}>${product.homepage_shop ? 'Selected' : 'Add to home'}</button></td>
          <td>
            <button type="button" class="table-action" data-edit="${product.id}">Edit</button>
            ${product.stock < 1
              ? `<button type="button" class="table-action" data-edit-stock="${product.id}">Add stock</button>`
              : ''}
            <button type="button" class="table-action" data-delete-product="${product.id}">Remove</button>
          </td>
        </tr>
      `).join('')
      : '<tr><td colspan="7">No products yet.</td></tr>';
  }

  populateProductSelects();
  renderCollectionTable();
}

function populateCategorySelect() {
  const select = $('#productForm select[name="category"]');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Choose a category</option>' + categories
    .map((category) => `<option value="${safe(category.name)}" ${!category.active && category.name !== selected ? 'disabled' : ''}>${safe(category.name)}${category.active ? '' : ' · Inactive'}</option>`)
    .join('');
  if (categories.some((category) => category.name === selected)) select.value = selected;
}

function renderCategories() {
  const list = $('#categoriesList');
  if (!list) return;
  const search = ($('#categorySearch')?.value || '').trim().toLowerCase();
  const status = $('#categoryStatusFilter')?.value || 'all';
  const filtered = categories.filter((category) => {
    const matchesSearch = `${category.name} ${category.description || ''}`.toLowerCase().includes(search);
    const matchesStatus = status === 'all' || (status === 'active' ? category.active : !category.active);
    return matchesSearch && matchesStatus;
  });
  list.innerHTML = filtered.length
    ? filtered.map((category) => `
      <article class="category-admin-card">
        ${category.image
          ? `<img class="category-admin-image" src="${safe(category.image)}" alt="${safe(category.name)}">`
          : '<div class="category-admin-image category-admin-placeholder" aria-hidden="true">BS</div>'}
        <div class="category-admin-content">
          <div class="category-admin-title">
            <h3>${safe(category.name)}</h3>
            <span class="status-tag ${category.active ? '' : 'off'}">${category.active ? 'Active' : 'Inactive'}</span>
          </div>
          <p>${safe(category.description || 'No description added.')}</p>
          <div class="category-admin-meta">
            <span>${Number(category.product_count) || 0} product${Number(category.product_count) === 1 ? '' : 's'}</span>
            <span>Created ${safe(formatIST(category.created_at))}</span>
            <span>Updated ${safe(formatIST(category.updated_at))}</span>
          </div>
          <div class="category-admin-actions">
            <button class="table-action" type="button" data-edit-category="${category.id}">Edit</button>
            <button class="table-action" type="button" data-toggle-category="${category.id}">${category.active ? 'Deactivate' : 'Activate'}</button>
            <button class="table-action" type="button" data-delete-category="${category.id}">Delete</button>
          </div>
        </div>
      </article>
    `).join('')
    : `<p class="category-list-empty">${categories.length ? 'No categories match these filters.' : 'No categories yet. Add your first category.'}</p>`;
}

async function loadCategories() {
  const list = $('#categoriesList');
  if (list) list.innerHTML = '<p class="category-list-empty">Loading categories…</p>';
  try {
    categories = await api('/api/admin/categories');
    populateCategorySelect();
    renderCategories();
  } catch (error) {
    if (list) list.innerHTML = `<p class="category-list-error">Could not load categories: ${safe(error.message)} <button type="button" class="table-action" data-retry-categories>Retry</button></p>`;
    toast(`Could not load categories: ${error.message}`);
  }
}

function setupCategoriesPanel() {
  const tabs = $('.admin-tabs');
  const productsPanel = $('#productsPanel');
  if (!tabs || !productsPanel) return;
  const tab = document.createElement('button');
  tab.className = 'admin-tab';
  tab.dataset.tab = 'categories';
  tab.textContent = 'Categories';
  tabs.append(tab);
  productsPanel.insertAdjacentHTML('afterend', `
    <section id="categoriesPanel" class="admin-panel hidden">
      <div class="panel-heading"><div><h2>Category management</h2><p class="muted">Manage customer-facing product categories here. New Collection remains a separate section.</p></div><button class="button button-dark" id="newCategoryButton" type="button">+ Add category</button></div>
      <form id="categoryForm" class="product-form hidden">
        <input type="hidden" name="id">
        <label>Category name<input name="name" required maxlength="80" autocomplete="off"></label>
        <label class="check-label" id="categoryActiveField"><input name="active" type="checkbox" checked> Active category</label>
        <div class="form-actions"><button class="button button-dark" type="submit">Save category</button><button class="button button-outline" id="cancelCategory" type="button">Cancel</button></div>
        <p id="categoryFormMessage" class="error-text"></p>
      </form>
      <div class="category-list-tools"><label>Search categories<input id="categorySearch" type="search" placeholder="Search by name or description"></label><label>Show<select id="categoryStatusFilter"><option value="all">All categories</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
      <div id="categoriesList" class="category-admin-list" aria-live="polite"></div>
      <dialog id="categoryDeleteDialog" class="category-delete-dialog">
        <h2>Delete category?</h2>
        <p id="categoryDeleteMessage"></p>
        <label id="categoryReassignField" class="hidden">Reassign products to an active category<select id="categoryReassignSelect"></select></label>
        <div class="form-actions"><button class="button button-outline" type="button" data-cancel-category-delete>Cancel</button><button class="button button-dark" type="button" id="confirmCategoryDelete">Delete category</button></div>
        <p id="categoryDeleteError" class="error-text" role="status"></p>
      </dialog>
    </section>`);
}

setupCategoriesPanel();

function resetCategoryForm() {
  const form = $('#categoryForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  form.elements.active.checked = true;
  $('#categoryFormMessage').textContent = '';
  form.classList.remove('hidden');
  form.elements.name.focus();
}

function editCategory(category) {
  const form = $('#categoryForm');
  form.elements.id.value = category.id;
  form.elements.name.value = category.name;
  form.elements.active.checked = category.active;
  $('#categoryFormMessage').textContent = '';
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#newCategoryButton')?.addEventListener('click', resetCategoryForm);
$('#cancelCategory')?.addEventListener('click', () => {
  $('#categoryForm')?.classList.add('hidden');
  $('#categoryFormMessage').textContent = '';
});
$('#categorySearch')?.addEventListener('input', renderCategories);
$('#categoryStatusFilter')?.addEventListener('change', renderCategories);

let categoryToDelete = null;
function openCategoryDeleteDialog(category) {
  categoryToDelete = category;
  const count = Number(category.product_count) || 0;
  const select = $('#categoryReassignSelect');
  const field = $('#categoryReassignField');
  const alternatives = categories.filter(item => item.active && item.id !== category.id);
  select.innerHTML = '<option value="">Choose a category</option>' + alternatives
    .map(item => `<option value="${item.id}">${safe(item.name)}</option>`).join('');
  field.classList.toggle('hidden', count === 0);
  $('#categoryDeleteMessage').textContent = count
    ? `${count} product${count === 1 ? '' : 's'} are assigned to "${category.name}". Select an active category to move them before deletion.`
    : `Delete "${category.name}"? This action cannot be undone.`;
  $('#categoryDeleteError').textContent = '';
  $('#confirmCategoryDelete').disabled = count > 0 && alternatives.length === 0;
  if (count > 0 && alternatives.length === 0) $('#categoryDeleteError').textContent = 'Create or activate another category before deleting this one.';
  $('#categoryDeleteDialog').showModal();
}

$('#categoryDeleteDialog [data-cancel-category-delete]')?.addEventListener('click', () => $('#categoryDeleteDialog').close());
$('#categoryDeleteDialog')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#confirmCategoryDelete')?.addEventListener('click', async (event) => {
  if (!categoryToDelete) return;
  const button = event.currentTarget;
  button.disabled = true;
  $('#categoryDeleteError').textContent = '';
  try {
    const reassignTo = $('#categoryReassignSelect').value;
    if (Number(categoryToDelete.product_count) > 0 && !reassignTo) {
      $('#categoryDeleteError').textContent = 'Choose an active category for these products.';
      return;
    }
    const payload = reassignTo ? { reassign_to: Number(reassignTo) } : {};
    await api(`/api/admin/categories/${categoryToDelete.id}`, { method: 'DELETE', body: JSON.stringify(payload) });
    $('#categoryDeleteDialog').close();
    categoryToDelete = null;
    await Promise.all([loadCategories(), loadProducts(), loadCollections(), loadOffers()]);
    toast('Category deleted.');
  } catch (error) {
    $('#categoryDeleteError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#categoriesList')?.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry-categories]')) {
    await loadCategories();
    return;
  }
  const editButton = event.target.closest('[data-edit-category]');
  const deleteButton = event.target.closest('[data-delete-category]');
  const toggleButton = event.target.closest('[data-toggle-category]');
  try {
    if (editButton) {
      const category = categories.find((item) => item.id === Number(editButton.dataset.editCategory));
      if (!category) return;
      editCategory(category);
    }
    if (deleteButton) {
      const category = categories.find((item) => item.id === Number(deleteButton.dataset.deleteCategory));
      if (category) openCategoryDeleteDialog(category);
    }
    if (toggleButton) {
      const category = categories.find((item) => item.id === Number(toggleButton.dataset.toggleCategory));
      if (!category) return;
      const active = !category.active;
      await api(`/api/admin/categories/${category.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active })
      });
      await Promise.all([loadCategories(), loadProducts()]);
      toast(active ? 'Category activated.' : 'Category deactivated. Its products are no longer available to customers.');
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#categoryForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  button.disabled = true;
  const id = form.elements.id.value;
  try {
    const existingCategory = categories.find((category) => category.id === Number(id));
    const payload = {
      name: form.elements.name.value,
      description: existingCategory?.description || '',
      image: existingCategory?.image || '',
      active: form.elements.active.checked
    };
    if (id) await api(`/api/admin/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    form.classList.add('hidden');
    await Promise.all([loadCategories(), loadProducts(), loadCollections(), loadOffers()]);
    toast(id ? 'Category saved.' : 'Category added.');
  } catch (error) {
    $('#categoryFormMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function resetProduct() {
  const form = $('#productForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  form.elements.image.value = '';
  setProductImagePreview('');
  updateProductDiscountPreview();
  $('#productFormMessage').textContent = '';
  form.classList.remove('hidden');
}

function updateDiscountPreview(form, preview) {
  if (!form || !preview) return;
  const originalPrice = Number(form.elements.price.value);
  const rawOfferPrice = form.elements.offer_price.value.trim();
  const rawDiscountPercent = form.elements.discount_percent.value.trim();
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    preview.textContent = 'Enter an original price greater than ₹0.';
    return;
  }
  if (rawOfferPrice) {
    const offerPrice = Number(rawOfferPrice);
    if (!Number.isFinite(offerPrice) || offerPrice <= 0 || offerPrice >= originalPrice) {
      preview.textContent = 'Offer price must be greater than ₹0 and lower than the original price.';
      return;
    }
    const discountPercent = Math.max(1,Math.round((originalPrice - offerPrice) * 100 / originalPrice));
    const saving = Math.round((originalPrice - offerPrice) * 100) / 100;
    preview.textContent = `Offer price: ${money(offerPrice)} · Customer saves ${money(saving)} · ${discountPercent}% OFF`;
    return;
  }
  if (!rawDiscountPercent || Number(rawDiscountPercent) === 0) {
    preview.textContent = `Selling price: ${money(originalPrice)}. No offer discount.`;
    return;
  }
  const discountPercent = Number(rawDiscountPercent);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    preview.textContent = 'Discount must be a whole-number percentage from 0 to 100.';
    return;
  }
  const sellingPrice = Math.round(originalPrice * (100 - discountPercent)) / 100;
  const saving = Math.round((originalPrice - sellingPrice) * 100) / 100;
  preview.textContent = `${sellingPrice > 0 ? `Calculated offer price: ${money(sellingPrice)}` : 'Free at 100% off'} · Customer saves ${money(saving)} · ${discountPercent}% OFF`;
}

function updateProductDiscountPreview() {
  updateDiscountPreview($('#productForm'), $('#productDiscountPreview'));
}

function bindDiscountInputs(form, preview) {
  if (!form) return;
  form.elements.price?.addEventListener('input', () => {
    const originalPrice = Number(form.elements.price.value);
    const offerPrice = Number(form.elements.offer_price.value);
    if (form.elements.offer_price.value.trim() && Number.isFinite(originalPrice) && originalPrice > offerPrice) {
      form.elements.discount_percent.value = String(Math.max(1,Math.round((originalPrice - offerPrice) * 100 / originalPrice)));
    }
    updateDiscountPreview(form, preview);
  });

  form.elements.discount_percent?.addEventListener('input', (event) => {
    const originalPrice = Number(form.elements.price.value);
    const rawPercent = event.currentTarget.value.trim();
    if (rawPercent === '' || Number(rawPercent) === 0) {
      form.elements.offer_price.value = '';
    } else if (Number.isInteger(Number(rawPercent)) && Number(rawPercent) > 0 && Number(rawPercent) < 100 && Number.isFinite(originalPrice) && originalPrice > 0) {
      form.elements.offer_price.value = (Math.round(originalPrice * (100 - Number(rawPercent)) / 100)).toFixed(2);
    } else if (Number(rawPercent) === 100) {
      form.elements.offer_price.value = '';
    }
    updateDiscountPreview(form, preview);
  });

  form.elements.offer_price?.addEventListener('input', (event) => {
    const originalPrice = Number(form.elements.price.value);
    const offerPrice = Number(event.currentTarget.value);
    if (!event.currentTarget.value.trim()) {
      form.elements.discount_percent.value = '0';
    } else if (Number.isFinite(originalPrice) && originalPrice > offerPrice && offerPrice > 0) {
      form.elements.discount_percent.value = String(Math.max(1,Math.round((originalPrice - offerPrice) * 100 / originalPrice)));
    }
    updateDiscountPreview(form, preview);
  });
}

bindDiscountInputs($('#productForm'), $('#productDiscountPreview'));

function setProductImagePreview(source) {
  const preview = $('#productImagePreview');
  if (!preview) return;
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  delete preview.dataset.objectUrl;
  preview.src = source || '';
  preview.classList.toggle('hidden', !source);
}

$('#productImageFile')?.addEventListener('change', (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    event.currentTarget.value = '';
    $('#productFormMessage').textContent = 'Choose a JPEG, PNG, WebP, or GIF image.';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    event.currentTarget.value = '';
    $('#productFormMessage').textContent = 'Image must be 20 MB or smaller.';
    return;
  }
  const preview = $('#productImagePreview');
  if (preview) {
    const objectUrl = URL.createObjectURL(file);
    preview.dataset.objectUrl = objectUrl;
    preview.src = objectUrl;
    preview.classList.remove('hidden');
  }
  $('#productFormMessage').textContent = '';
});

async function uploadProductImage(file) {
  const response = await fetch('/api/admin/uploads', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {}
  if (!response.ok) throw new Error(payload.error || 'Could not upload image.');
  return payload.image;
}

$('#newProductButton')?.addEventListener('click', resetProduct);
$('#cancelProduct')?.addEventListener('click', () => $('#productForm')?.classList.add('hidden'));

$('#productsTable')?.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit]');
  const editStockButton = event.target.closest('[data-edit-stock]');
  const visibilityButton = event.target.closest('[data-visibility]');
  const availabilityButton = event.target.closest('[data-availability]');
  const homepageShopButton = event.target.closest('[data-homepage-shop]');
  const deleteButton = event.target.closest('[data-delete-product]');

  try {
    if (homepageShopButton) {
      const product = products.find((item) => item.id === Number(homepageShopButton.dataset.homepageShop));
      if (!product) return;
      const selected = homepageShopButton.dataset.selected !== 'true';
      await api(`/api/admin/products/${product.id}/homepage-shop`, {
        method: 'PATCH',
        body: JSON.stringify({ selected })
      });
      await loadProducts();
      toast(selected ? 'Product added to the homepage shop.' : 'Product removed from the homepage shop.');
    }

    if (editButton || editStockButton) {
      const productId = Number(editButton?.dataset.edit || editStockButton?.dataset.editStock);
      const product = products.find((item) => item.id === productId);
      if (!product) return;

      const form = $('#productForm');
      if (!form) return;
      form.classList.remove('hidden');
      Object.entries(product).forEach(([key, value]) => {
        const field = form.elements[key];
        if (!field) return;
        if (field.type === 'checkbox') field.checked = !!value;
        else field.value = value ?? '';
      });
      updateProductDiscountPreview();
      setProductImagePreview(product.image);
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (editStockButton) {
        form.elements.stock.focus();
        $('#productFormMessage').textContent = 'Enter a stock quantity greater than zero, save, then mark the product in stock.';
      }
    }

    if (visibilityButton) {
      const product = products.find((item) => item.id === Number(visibilityButton.dataset.visibility));
      if (!product) return;
      const active = visibilityButton.dataset.active === 'true';
      await api(`/api/admin/products/${product.id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ active })
      });
      await loadProducts();
      await loadSummary();
      toast(active ? 'Product is visible in the shop.' : 'Product hidden from the shop.');
    }

    if (availabilityButton) {
      const product = products.find((item) => item.id === Number(availabilityButton.dataset.availability));
      if (!product) return;
      const outOfStock = availabilityButton.dataset.outOfStock === 'true';
      await api(`/api/admin/products/${product.id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ out_of_stock: outOfStock })
      });
      await loadProducts();
      toast(outOfStock ? 'Product marked out of stock.' : 'Product marked in stock.');
    }

    if (deleteButton) {
      const product = products.find((item) => item.id === Number(deleteButton.dataset.deleteProduct));
      if (!product || !confirm(`Permanently remove "${product.name}" from the shop and admin catalogue? This cannot be undone.`)) return;
      await api(`/api/admin/products/${product.id}`, { method: 'DELETE' });
      await Promise.all([loadProducts(), loadCategories(), loadCollections(), loadOffers(), loadSummary()]);
      toast('Product permanently removed.');
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#productForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter;
  submitButton.disabled = true;

  const formData = new FormData(form);
  const id = formData.get('id');
  const payload = {
    name: formData.get('name'),
    category: formData.get('category'),
    price: Number(formData.get('price')),
    offer_price: String(formData.get('offer_price') || '').trim() === '' ? null : Number(formData.get('offer_price')),
    discount_percent: String(formData.get('discount_percent') || '').trim() === '' ? 0 : Number(formData.get('discount_percent')),
    stock: Number(formData.get('stock')),
    image: formData.get('image'),
    description: formData.get('description'),
    featured: formData.has('featured'),
    active: true
  };

  try {
    const imageFile = formData.get('imageFile');
    if (imageFile?.size) payload.image = await uploadProductImage(imageFile);
    if (id) {
      const previous = products.find((item) => item.id === Number(id));
      payload.active = previous?.active ?? true;
      await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
    }

    form.reset();
    setProductImagePreview('');
    form.classList.add('hidden');
    await loadProducts();
    await loadSummary();
    await loadOffers();
    updateOfferCatalogPriceHint();
    toast('Product saved.');
  } catch (error) {
    $('#productFormMessage').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

async function loadCollections() {
  collectionItems = await api('/api/admin/collections');
  renderCollectionTable();
}

function renderCollectionTable() {
  const table = $('#collectionTable');
  if (!table) return;
  table.innerHTML = products.length
    ? products.map((product) => {
      const item = collectionItems.find((entry) => Number(entry.product_id) === Number(product.id));
      const status = !product.active
        ? 'Product hidden'
        : item
          ? (item.active ? 'In collection' : 'Hidden in collection')
          : 'Not in collection';
      return `
        <tr>
          <td><img src="${safe(product.image)}" alt="${safe(product.name)}"><span class="prod-name">${safe(product.name)}</span></td>
          <td>${safe(product.category)}</td>
          <td>${item ? item.sort_order : '—'}</td>
          <td><span class="status-tag ${product.active && item && item.active ? '' : 'off'}">${status}</span></td>
          <td>
            ${item
              ? `<button class="table-action" data-edit-collection="${item.id}">Edit</button><button class="table-action" data-remove-collection="${item.id}">Remove</button>`
              : `<button class="table-action" data-add-collection-product="${product.id}" ${product.active ? '' : 'disabled'} title="${product.active ? 'Add product to New Collection' : 'Unhide this product before adding it'}">Add to collection</button>`}
          </td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="5">No products in the catalogue yet.</td></tr>';
}

function resetCollection() {
  const form = $('#collectionForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  form.elements.sort_order.value = '0';
  form.elements.active.checked = true;
  $('#collectionFormMessage').textContent = '';
  form.classList.remove('hidden');
}

$('#newCollectionButton')?.addEventListener('click', resetCollection);
$('#cancelCollection')?.addEventListener('click', () => $('#collectionForm')?.classList.add('hidden'));

$('#collectionTable')?.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-collection]');
  const deleteButton = event.target.closest('[data-remove-collection]');
  const addButton = event.target.closest('[data-add-collection-product]');

  try {
    if (addButton) {
      const productId = Number(addButton.dataset.addCollectionProduct);
      const sortOrder = collectionItems.reduce((maximum, item) => Math.max(maximum, Number(item.sort_order) || 0), -1) + 1;
      await api('/api/admin/collections', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, sort_order: sortOrder })
      });
      await loadCollections();
      toast('Product added to New Collection.');
    }

    if (editButton) {
      const item = collectionItems.find((entry) => entry.id === Number(editButton.dataset.editCollection));
      if (!item) return;

      const form = $('#collectionForm');
      if (!form) return;
      form.classList.remove('hidden');
      form.elements.id.value = item.id;
      form.elements.product_id.value = item.product_id;
      form.elements.sort_order.value = item.sort_order;
      form.elements.active.checked = !!item.active;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (deleteButton) {
      const item = collectionItems.find((entry) => entry.id === Number(deleteButton.dataset.removeCollection));
      if (!item) return;
      if (!confirm(`Remove "${item.name}" from the New Collection?`)) return;
      await api(`/api/admin/collections/${item.id}`, { method: 'DELETE' });
      await loadCollections();
      toast('Collection item removed.');
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#collectionForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter;
  submitButton.disabled = true;

  const formData = new FormData(form);
  const id = formData.get('id');
  const payload = {
    product_id: Number(formData.get('product_id')),
    sort_order: Number(formData.get('sort_order') || 0),
    active: formData.get('active') !== null
  };

  try {
    if (id) {
      await api(`/api/admin/collections/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/admin/collections', { method: 'POST', body: JSON.stringify(payload) });
    }

    form.reset();
    form.classList.add('hidden');
    await loadCollections();
    toast('New Collection updated.');
  } catch (error) {
    $('#collectionFormMessage').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

function renderOfferTable() {
  const table = $('#offersTable');
  if (!table) return;

  const combined = [
    ...banners.map((item) => ({ ...item, type: 'banner' })),
    ...offers.map((item) => ({ ...item, type: 'saree' }))
  ].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  table.innerHTML = combined.length
    ? combined.map((item) => {
        const label = item.type === 'banner'
          ? safe(item.title || 'Offer banner')
          : safe(item.offer_label || item.product_name || 'Special offer');

        const details = item.type === 'banner'
          ? `${safe(item.button_text || 'Shop offers')} · ${safe(item.start_date || '—')} to ${safe(item.end_date || '—')}`
          : `${safe(item.product_name || item.name || 'Saree')} · ${money(item.selling_price ?? item.price ?? 0)}${Number(item.discountPercent) > 0 ? ` · ${Number(item.discountPercent)}% OFF` : ''}`;

        return `
          <tr>
            <td>${label}</td>
            <td>${item.type === 'banner' ? 'Banner' : 'Saree'}</td>
            <td>${details}</td>
            <td><span class="status-tag ${item.active ? '' : 'off'}">${item.active ? 'Active' : 'Inactive'}</span></td>
            <td>
              <button class="table-action" data-edit-offer="${item.id}" data-offer-type="${item.type}">Edit</button>
              <button class="table-action" data-remove-offer="${item.id}" data-offer-type="${item.type}">Delete</button>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="5">No offers yet.</td></tr>';
}

async function loadBanners() {
  banners = await api('/api/admin/banners');
  renderOfferTable();
}

async function loadOffers() {
  offers = await api('/api/admin/offers');
  renderOfferTable();
}

function resetOfferForm() {
  const form = $('#offerForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  form.elements.type.value = 'banner';
  form.elements.button_text.value = 'Shop offers';
  form.elements.button_link.value = '/products';
  form.elements.sort_order.value = '0';
  form.elements.active.checked = true;
  form.elements.featured.checked = false;
  $('#offerFormMessage').textContent = '';
  form.querySelector("select[name='type']").dispatchEvent(new Event('change'));
  form.classList.remove('hidden');
}

$('#newOfferButton')?.addEventListener('click', resetOfferForm);
$('#cancelOffer')?.addEventListener('click', () => $('#offerForm')?.classList.add('hidden'));

$('#offerForm select[name="type"]')?.addEventListener('change', (event) => {
  const form = $('#offerForm');
  if (!form) return;
  const isBanner = event.target.value === 'banner';
  const productField = form.querySelector("select[name='product_id']");
  const labelField = form.querySelector("input[name='title']");
  const buttonText = form.querySelector("input[name='button_text']");
  const buttonLink = form.querySelector("input[name='button_link']");
  const imageField = form.querySelector("input[name='image']");
  const descriptionField = form.querySelector("textarea[name='description']");
  const pricingFields = form.querySelector('.offer-product-pricing');
  const pricingPreview = $('#offerProductDiscountPreview');

  if (productField) productField.disabled = isBanner;
  if (labelField) labelField.placeholder = isBanner ? 'Banner headline' : 'Offer label';
  ['price', 'offer_price', 'discount_percent'].forEach((name) => {
    if (form.elements[name]) {
      form.elements[name].disabled = isBanner;
      form.elements[name].required = !isBanner && name === 'price';
    }
  });
  pricingFields?.classList.toggle('hidden', isBanner);
  pricingPreview?.classList.toggle('hidden', isBanner);
  if (buttonText) buttonText.disabled = !isBanner;
  if (buttonLink) buttonLink.disabled = !isBanner;
  if (imageField) imageField.disabled = !isBanner;
  if (descriptionField) descriptionField.disabled = !isBanner;
  $('#offerCatalogPriceHint').textContent = isBanner
    ? 'Special-offer products automatically follow the price and discount set in Product catalogue.'
    : 'Automatically follows the selected product’s current catalogue price and discount.';
});

function updateOfferCatalogPriceHint() {
  const select = $('#offerForm select[name="product_id"]');
  const hint = $('#offerCatalogPriceHint');
  const product = products.find((item) => item.id === Number(select?.value));
  if (!hint) return;
  if (!product) {
    hint.textContent = 'Choose a product to edit its catalogue price and discount here.';
    return;
  }
  const discount = Number(product.discountPercent) > 0 ? ` · ${Number(product.discountPercent)}% OFF` : '';
  hint.textContent = `Current catalogue price: ${money(product.selling_price ?? product.price)}${discount}. Changes here also update the product catalogue and checkout.`;
}

function setupOfferPricingFields() {
  const form = $('#offerForm');
  const typeSelect = form?.elements.type;
  const typeRow = typeSelect?.closest('.form-two');
  if (!form || !typeRow) return;
  typeRow.insertAdjacentHTML('afterend', `
    <div class="form-three offer-product-pricing">
      <label>Original Price (₹)<input name="price" type="number" min="0.01" step="0.01" required></label>
      <label>Offer Price (₹) — optional<input name="offer_price" type="number" min="0.01" step="0.01" placeholder="Leave empty for no offer"></label>
      <label>Discount (%) — optional<input name="discount_percent" type="number" min="0" max="100" step="1" placeholder="0 to 100"></label>
    </div>
    <p id="offerProductDiscountPreview" class="discount-preview" aria-live="polite">Choose a product to edit its catalogue price and discount.</p>
  `);
  bindDiscountInputs(form, $('#offerProductDiscountPreview'));
  form.elements.product_id.addEventListener('change', () => {
    const product = products.find((item) => item.id === Number(form.elements.product_id.value));
    if (product) {
      form.elements.price.value = product.price;
      form.elements.offer_price.value = product.offer_price ?? '';
      form.elements.discount_percent.value = product.discount_percent ?? 0;
    } else {
      form.elements.price.value = '';
      form.elements.offer_price.value = '';
      form.elements.discount_percent.value = '';
    }
    updateDiscountPreview(form, $('#offerProductDiscountPreview'));
    updateOfferCatalogPriceHint();
  });
}

setupOfferPricingFields();

$('#offerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter;
  submitButton.disabled = true;

  const formData = new FormData(form);
  const id = formData.get('id');
  const type = formData.get('type');

  try {
    if (type === 'banner') {
      const payload = {
        title: formData.get('title'),
        description: formData.get('description'),
        image: formData.get('image'),
        button_text: formData.get('button_text'),
        button_link: formData.get('button_link'),
        start_date: formData.get('start_date'),
        end_date: formData.get('end_date'),
        active: formData.get('active') !== null,
        sort_order: Number(formData.get('sort_order') || 0)
      };

      if (!payload.title || !payload.image) throw new Error('Banner title and image are required.');
      if (id) await api(`/api/admin/banners/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/admin/banners', { method: 'POST', body: JSON.stringify(payload) });
    } else {
      const payload = {
        product_id: Number(formData.get('product_id')),
        price: Number(formData.get('price')),
        offer_price: String(formData.get('offer_price') || '').trim() === '' ? null : Number(formData.get('offer_price')),
        discount_percent: String(formData.get('discount_percent') || '').trim() === '' ? 0 : Number(formData.get('discount_percent')),
        offer_label: formData.get('title'),
        start_date: formData.get('start_date'),
        end_date: formData.get('end_date'),
        active: formData.get('active') !== null,
        sort_order: Number(formData.get('sort_order') || 0),
        featured: formData.get('featured') !== null
      };
      if (!Number.isInteger(payload.product_id) || payload.product_id <= 0) throw new Error('Select a valid product.');
      if (!Number.isFinite(payload.price) || payload.price <= 0) throw new Error('Original price must be greater than zero.');
      if (id) await api(`/api/admin/offers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/admin/offers', { method: 'POST', body: JSON.stringify(payload) });
    }

    form.reset();
    form.classList.add('hidden');
    await Promise.all([loadBanners(), loadOffers(), loadProducts()]);
    updateOfferCatalogPriceHint();
    toast('Offer saved.');
  } catch (error) {
    $('#offerFormMessage').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

$('#offersTable')?.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-offer]');
  const deleteButton = event.target.closest('[data-remove-offer]');

  try {
    if (editButton) {
      const type = editButton.dataset.offerType;
      const item = type === 'banner'
        ? banners.find((entry) => entry.id === Number(editButton.dataset.editOffer))
        : offers.find((entry) => entry.id === Number(editButton.dataset.editOffer));
      if (!item) return;

      const form = $('#offerForm');
      if (!form) return;
      form.reset();
      form.elements.id.value = item.id;
      form.elements.type.value = type;

      if (type === 'banner') {
        form.elements.title.value = item.title || '';
        form.elements.description.value = item.description || '';
        form.elements.image.value = item.image || '';
        form.elements.button_text.value = item.button_text || 'Shop offers';
        form.elements.button_link.value = item.button_link || '/products';
        form.elements.start_date.value = item.start_date || '';
        form.elements.end_date.value = item.end_date || '';
        form.elements.sort_order.value = item.sort_order || 0;
        form.elements.active.checked = !!item.active;
      } else {
        form.elements.product_id.value = item.product_id;
        form.elements.title.value = item.offer_label || '';
        form.elements.start_date.value = item.start_date || '';
        form.elements.end_date.value = item.end_date || '';
        form.elements.sort_order.value = item.sort_order || 0;
        form.elements.active.checked = !!item.active;
        form.elements.featured.checked = !!item.featured;
      }

      form.classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#offerForm select[name="type"]')?.dispatchEvent(new Event('change'));
      if (type === 'saree') form.elements.product_id.dispatchEvent(new Event('change'));
      updateOfferCatalogPriceHint();
    }

    if (deleteButton) {
      const type = deleteButton.dataset.offerType;
      const item = type === 'banner'
        ? banners.find((entry) => entry.id === Number(deleteButton.dataset.removeOffer))
        : offers.find((entry) => entry.id === Number(deleteButton.dataset.removeOffer));
      if (!item) return;

      if (!confirm(`Delete this ${type === 'banner' ? 'banner' : 'special offer'}?`)) return;
      await api(type === 'banner' ? `/api/admin/banners/${item.id}` : `/api/admin/offers/${item.id}`, { method: 'DELETE' });
      await loadBanners();
      await loadOffers();
      toast(type === 'banner' ? 'Banner deleted.' : 'Special offer removed.');
    }
  } catch (error) {
    toast(error.message);
  }
});

async function loadOrders() {
  const params = new URLSearchParams();
  if ($('#orderDateFrom')?.value) params.set('from', $('#orderDateFrom').value);
  if ($('#orderDateTo')?.value) params.set('to', $('#orderDateTo').value);
  params.set('direction', $('#orderDateDirection')?.value || 'desc');
  const orders = await api(`/api/admin/orders?${params.toString()}`);
  const container = $('#ordersList');
  if (!container) return;

  container.innerHTML = orders.length
    ? orders.map((order) => `
      <article class="order-card">
        <div class="order-top">
          <div>
            <h3>Order #${order.id}</h3>
            <p class="muted">${safe(formatIST(order.created_at))} · ${safe(order.customer_name)}</p>
          </div>
          <strong class="order-total">${money(order.total)}</strong>
        </div>
        <div class="order-details">
          <div><strong>Contact</strong><br>${safe(order.email)}<br>${safe(order.phone)}</div>
          <div><strong>Delivery address</strong><br>${safe(order.address)}</div>
          <div><strong>Payment preference</strong><br>${safe(order.payment_method)} · ${safe(order.payment_status)}</div>
          <div><strong>Items</strong><br>${(order.items || []).map((item) => `${safe(item.name)} × ${item.quantity}`).join('<br>')}</div>
        </div>
        <div class="order-items">${(order.items || []).map((item) => `${safe(item.name)} × ${item.quantity} — ${money(item.price * item.quantity)}`).join('<br>')}</div>
        ${order.cancellation_date ? `<div class="order-stock-summary"><strong>Cancelled:</strong> ${safe(formatIST(order.cancellation_date))}<br><strong>Reason:</strong> ${safe(order.cancellation_reason || 'Not provided')}<br><strong>Quantity restored:</strong> ${Number(order.restored_quantity || 0)}</div>` : ''}
        ${(order.stock_adjustments || []).length ? `<div class="order-stock-history"><strong>Stock adjustment history</strong>${order.stock_adjustments.map((adjustment) => {
          const labels = {
            confirm_deduct: 'Deducted on confirmation',
            cancel_restore: 'Restored after cancellation',
            cancel_no_deduction: 'Cancelled before deduction',
            cancel_after_shipment: 'No automatic restoration after shipment',
            approved_return_restock: 'Return inspected and restocked'
          };
          const sign = adjustment.action === 'confirm_deduct' ? '−' : ['cancel_restore', 'approved_return_restock'].includes(adjustment.action) ? '+' : '';
          return `<div>${safe(formatIST(adjustment.created_at))} · ${safe(labels[adjustment.action] || adjustment.action)}${adjustment.product_name ? ` · ${safe(adjustment.product_name)}` : ''} · ${sign}${Number(adjustment.quantity || 0)}${adjustment.reason ? `<br><span>${safe(adjustment.reason)}</span>` : ''}</div>`;
        }).join('')}</div>` : ''}
        <div class="order-controls">
          <label for="status-${order.id}">Order status</label>
          <select id="status-${order.id}" data-status="${order.id}" ${['Cancelled','Delivered'].includes(order.status) ? 'disabled' : ''}>${['New', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'].map((status) => `<option ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select>
          ${['Cancelled','Delivered'].includes(order.status) ? '' : `<button class="table-action" data-update-order="${order.id}">Update status</button>`}
          <span class="status-tag">${safe(order.status)}</span>
          ${['Cancelled','Delivered'].includes(order.status) ? '' : `<label class="cancel-reason-field ${order.status === 'Cancelled' ? '' : 'hidden'}" data-cancel-reason-field="${order.id}">Cancellation reason<input data-cancel-reason="${order.id}" maxlength="500" value="${safe(order.cancellation_reason || '')}" placeholder="Required when cancelling"></label>`}
          ${order.shipped_at && order.stock_deducted && !order.stock_restored && ['Cancelled','Delivered'].includes(order.status) ? `<label class="return-condition-field">Return condition / approval reason<input data-return-reason="${order.id}" maxlength="500" placeholder="Describe inspection and approve restocking"></label><button class="table-action" data-approve-return="${order.id}">Approve return &amp; restock</button>` : ''}
        </div>
      </article>
    `).join('')
    : '<div class="empty-state">No orders yet. New customer orders will appear here.</div>';
}

async function loadCustomers() {
  const params = new URLSearchParams();
  if ($('#customerDateFrom')?.value) params.set('from', $('#customerDateFrom').value);
  if ($('#customerDateTo')?.value) params.set('to', $('#customerDateTo').value);
  params.set('sort', $('#customerDateSort')?.value || 'created');
  params.set('direction', $('#customerDateDirection')?.value || 'desc');
  customers = await api(`/api/admin/customers?${params.toString()}`);
  const table = $('#customersTable');
  if (!table) return;
  table.innerHTML = customers.length
    ? customers.map((customer) => `
      <tr>
        <td>${safe(customer.name)}</td>
        <td>${safe(customer.email)}</td>
        <td>${safe(customer.phone || '—')}</td>
        <td>${safe(formatIST(customer.created_at))}</td>
        <td>${safe(formatIST(customer.updated_at))}</td>
        <td><button class="table-action" type="button" data-view-addresses="${customer.id}">View addresses</button></td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">No customer accounts found for these dates.</td></tr>';
}

async function refreshPasswordResetNotifications() {
  const result = await api('/api/admin/password-reset-requests');
  const requests = result.requests || [];
  const pendingRequests = requests.filter((request) => request.status === 'PENDING');
  const table = $('#passwordResetRequestsTable');
  if (table) {
    table.innerHTML = requests.length
      ? requests.map((request) => {
        const status = String(request.status || '').toLowerCase();
        const actions = request.status === 'PENDING'
          ? `<button class="table-action" type="button" data-password-reset-action="approve" data-request-id="${request.id}">Approve</button><button class="table-action" type="button" data-password-reset-action="reject" data-request-id="${request.id}">Reject</button>`
          : '—';
        return `<tr><td>${safe(request.email)}</td><td>${safe(formatIST(new Date(request.requested_at).toISOString()))}</td><td><span class="status-tag reset-status-${safe(status)}">${safe(request.status)}</span></td><td><div class="password-reset-actions">${actions}</div></td></tr>`;
      }).join('')
      : '<tr><td colspan="4">No password-reset requests.</td></tr>';
  }
  const badge = $('#customerResetBadge');
  if (badge) {
    badge.textContent = String(pendingRequests.length);
    badge.classList.toggle('hidden', pendingRequests.length === 0);
    badge.setAttribute('aria-label', `${pendingRequests.length} pending password reset request${pendingRequests.length === 1 ? '' : 's'}`);
  }
  const newRequests = pendingRequests.filter((request) => !observedPasswordResetRequestIds.has(request.id));
  if (hasLoadedPasswordResetNotifications && newRequests.length) {
    toast(`${newRequests.length} new password reset request${newRequests.length === 1 ? '' : 's'} waiting for approval.`);
  } else if (!hasLoadedPasswordResetNotifications && pendingRequests.length) {
    toast(`${pendingRequests.length} password reset request${pendingRequests.length === 1 ? '' : 's'} waiting for approval.`);
  }
  pendingRequests.forEach((request) => observedPasswordResetRequestIds.add(request.id));
  hasLoadedPasswordResetNotifications = true;
}

async function loadAdminAccess() {
  const result = await api('/api/admin/access-management');
  $('#adminAccessTable').innerHTML = result.admins.length
    ? result.admins.map((admin) => `
      <tr>
        <td>${safe(admin.email)}</td>
        <td>${admin.role === 'owner' ? 'Main Admin / Owner' : 'Admin'}</td>
        <td>${safe(admin.granted_by || 'Legacy access')}</td>
        <td>${safe(admin.granted_at ? formatIST(admin.granted_at) : '—')}</td>
        <td>${admin.role === 'owner' || admin.email.toLowerCase() === result.mainAdminEmail.toLowerCase()
          ? 'Protected owner'
          : `<button class="table-action address-delete" type="button" data-revoke-admin="${admin.id}" data-admin-email="${safe(admin.email)}">Revoke</button>`}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">No administrators are configured.</td></tr>';
  $('#adminAccessAudit').innerHTML = result.audit.length
    ? result.audit.map((entry) => `
      <tr>
        <td>${safe(entry.action.replaceAll('_', ' '))}</td>
        <td>${safe(entry.target_email || '—')}</td>
        <td>${safe(entry.actor_email)}</td>
        <td>${safe(formatIST(entry.created_at))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">No admin access changes have been recorded.</td></tr>';
}

async function loadOrderDataAudit() {
  const entries = await api('/api/admin/orders/clear-audit');
  const table = $('#orderDataClearAudit');
  if (!table) return;
  table.innerHTML = entries.length
    ? entries.map((entry) => `
      <tr>
        <td>${safe(entry.actor_email)}</td>
        <td>${safe(entry.deleted_orders)}</td>
        <td>${safe(formatIST(entry.created_at))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3">No order data has been cleared.</td></tr>';
}

function setupOrderDataPanel() {
  const tabs = $('.admin-tabs');
  const customersPanel = $('#customersPanel');
  if (!tabs || !customersPanel) return;
  const tab = document.createElement('button');
  tab.className = 'admin-tab hidden';
  tab.id = 'orderDataTab';
  tab.dataset.tab = 'order-data';
  tab.textContent = 'Order data';
  tabs.append(tab);
  customersPanel.insertAdjacentHTML('afterend', `
    <section id="orderDataPanel" class="admin-panel hidden">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">MAIN ADMIN ONLY</p>
          <h2>Clear order data</h2>
          <p class="muted">Permanently removes all customer and admin order records, status timelines, and stock-adjustment history. Products, customer accounts, and current inventory are retained; inventory is not recalculated.</p>
        </div>
      </div>
      <form id="clearOrderDataForm" class="clear-order-data-form">
        <label for="clearOrderDataConfirmation">Type <strong>CLEAR ALL ORDERS</strong> to confirm</label>
        <input id="clearOrderDataConfirmation" name="confirmation" autocomplete="off" spellcheck="false" required>
        <button class="button button-dark" type="submit">Clear all order data</button>
        <p id="clearOrderDataMessage" class="auth-message" role="status" aria-live="polite"></p>
      </form>
      <div class="table-wrap">
        <table><thead><tr><th>Cleared by</th><th>Orders removed</th><th>Date (IST)</th></tr></thead><tbody id="orderDataClearAudit"></tbody></table>
      </div>
    </section>`);
}

setupOrderDataPanel();

function setupReviewContactPanels() {
  const tabs = $('.admin-tabs');
  const panelAnchor = $('#orderDataPanel') || $('#customersPanel');
  if (!tabs || !panelAnchor) return;
  const reviewStyles = document.createElement('link');
  reviewStyles.rel = 'stylesheet';
  reviewStyles.href = '/review-ui.css';
  document.head.append(reviewStyles);

  tabs.insertAdjacentHTML('beforeend', `
    <button class="admin-tab" data-tab="reviews" id="reviewsAdminTab" type="button">Reviews</button>
    <button class="admin-tab" data-tab="contact-settings" id="contactSettingsTab" type="button">Contact details</button>`);
  panelAnchor.insertAdjacentHTML('afterend', `
    <section id="reviewsAdminPanel" class="admin-panel hidden">
      <div class="panel-heading">
        <div><h2>Customer reviews</h2><p class="muted">Approve reviews to publish them on the storefront.</p></div>
        <div class="review-admin-tools">
          <label for="reviewStatusFilter">Status</label>
          <select id="reviewStatusFilter"><option value="pending">Pending</option><option value="all">All reviews</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
          <button class="button button-outline" id="refreshReviews" type="button">Refresh</button>
        </div>
      </div>
      <div id="adminReviewsList" class="admin-reviews-list" aria-live="polite"><p class="muted">Loading reviews...</p></div>
    </section>
    <section id="contactSettingsPanel" class="admin-panel hidden">
      <div class="panel-heading"><div><h2>Store contact details</h2><p class="muted">Published on the storefront contact page.</p></div></div>
      <form id="contactSettingsForm" class="admin-form contact-settings-form">
        <label>Phone number<input name="phone" type="tel" maxlength="30" required></label>
        <label>Email address<input name="email" type="email" maxlength="254" required></label>
        <label>Store address<input name="address" maxlength="300" required></label>
        <p id="contactSettingsMessage" class="auth-message" role="status" aria-live="polite"></p>
        <button class="button button-dark" type="submit">Save contact details</button>
      </form>
    </section>`);
}

setupReviewContactPanels();

async function loadAdminReviews() {
  const container = $('#adminReviewsList');
  if (!container) return;
  const status = $('#reviewStatusFilter')?.value || 'pending';
  try {
    const result = await api(`/api/admin/reviews?status=${encodeURIComponent(status)}`);
    container.innerHTML = result.reviews.length
      ? result.reviews.map((review) => `
        <article class="admin-review">
          <div class="admin-review-heading">
            <strong>${safe(review.customer_name)}</strong>
            <span>${safe(review.customer_email)}</span>
            <span class="status-tag review-status-${safe(review.status)}">${safe(review.status)}</span>
          </div>
          <div class="rating" aria-label="${safe(review.rating)} out of 5 stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
          <p>${safe(review.description)}</p>
          <small>${safe(formatIST(review.created_at))}</small>
          ${review.status === 'pending' ? `<div class="admin-review-actions"><button class="button button-dark" type="button" data-review-status="approved" data-review-id="${safe(review.id)}">Approve</button><button class="button button-outline" type="button" data-review-status="rejected" data-review-id="${safe(review.id)}">Reject</button></div>` : ''}
        </article>`).join('')
      : '<p class="muted">No reviews match this status.</p>';
  } catch (error) {
    container.innerHTML = `<p class="error-text">${safe(error.message)}</p>`;
  }
}

async function loadAdminContact() {
  const form = $('#contactSettingsForm');
  if (!form) return;
  const message = $('#contactSettingsMessage');
  try {
    const contact = await api('/api/admin/contact');
    form.elements.phone.value = contact.phone;
    form.elements.email.value = contact.email;
    form.elements.address.value = contact.address;
    form.querySelectorAll('input, button[type="submit"]').forEach((field) => { field.disabled = !contact.canEdit; });
    message.textContent = contact.canEdit ? '' : 'Only the Main Admin can edit contact details.';
  } catch (error) {
    message.textContent = error.message;
  }
}

$('#refreshReviews')?.addEventListener('click', loadAdminReviews);
$('#reviewStatusFilter')?.addEventListener('change', loadAdminReviews);
$('#reviewsAdminPanel')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-review-status]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/reviews/${encodeURIComponent(button.dataset.reviewId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: button.dataset.reviewStatus })
    });
    toast(result.message);
    await loadAdminReviews();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});

$('#contactSettingsForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const message = $('#contactSettingsMessage');
  button.disabled = true;
  message.textContent = '';
  message.classList.remove('success');
  try {
    const result = await api('/api/admin/contact', {
      method: 'PUT',
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    message.textContent = result.message;
    message.classList.add('success');
    toast(result.message);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#clearOrderDataForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const confirmation = new FormData(form).get('confirmation');
  if (confirmation !== 'CLEAR ALL ORDERS') {
    $('#clearOrderDataMessage').textContent = 'Type CLEAR ALL ORDERS exactly to confirm.';
    return;
  }
  button.disabled = true;
  $('#clearOrderDataMessage').textContent = '';
  try {
    const result = await api('/api/admin/orders/clear', {
      method: 'POST',
      body: JSON.stringify({ confirmation })
    });
    form.reset();
    $('#clearOrderDataMessage').textContent = result.message;
    await Promise.all([loadOrders(), loadSummary(), loadOrderDataAudit()]);
    toast(result.message);
  } catch (error) {
    $('#clearOrderDataMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#ownerSetupForm [name="email"]')?.setAttribute('readonly', 'readonly');

$('#grantAdminForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const email = new FormData(form).get('email').trim();
  button.disabled = true;
  $('#adminAccessMessage').textContent = '';
  try {
    const result = await api('/api/admin/access-management', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    form.reset();
    $('#adminAccessMessage').textContent = result.message;
    await loadAdminAccess();
    toast(result.message);
  } catch (error) {
    $('#adminAccessMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#adminAccessPanel')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-admin]');
  if (!button) return;
  const email = button.dataset.adminEmail;
  if (!window.confirm(`Revoke administrator access for ${email}? They will lose admin access immediately.`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/access-management/${encodeURIComponent(button.dataset.revokeAdmin)}`, { method: 'DELETE' });
    $('#adminAccessMessage').textContent = result.message;
    await loadAdminAccess();
    toast(result.message);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});

$('#refreshAdminAccess')?.addEventListener('click', async () => {
  try {
    await loadAdminAccess();
    toast('Admin access list refreshed.');
  } catch (error) {
    toast(error.message);
  }
});

async function loadSiteImages() {
  const [images, uploadedImages, driveConfig] = await Promise.all([
    api('/api/admin/site-images'),
    api('/api/admin/site-images/library'),
    api('/api/admin/site-image-config')
  ]);
  siteImages = images;
  siteImageDriveConfig = driveConfig;
  const library = new Map();
  uploadedImages.forEach((item) => library.set(item.image, { image: item.image, name: item.name }));
  siteImages.forEach((item) => {
    [item.image, item.previous_image, item.default_image].filter(Boolean)
      .forEach((image) => {
        if (!library.has(image)) library.set(image, { image, name: item.label });
      });
  });
  siteImageLibrary = [...library.values()];
  const container = $('#siteImagesList');
  if (!container) return;
  container.querySelectorAll('[data-site-image-new-preview]').forEach((preview) => {
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  });
  container.innerHTML = siteImages.map((item) => `
    <article class="site-image-card" data-site-image-card="${safe(item.key)}" data-current-image="${safe(item.image)}">
      <div class="site-image-previews">
        <figure>
          ${item.image ? `<img src="${safe(item.image)}" alt="${safe(item.label)} current image" loading="lazy">` : '<div class="site-image-empty">No current image</div>'}
          <figcaption>Current image</figcaption>
        </figure>
        <figure>
          <img class="hidden" data-site-image-new-preview alt="Replacement image preview" loading="lazy">
          <div class="site-image-empty" data-site-image-preview-placeholder>Choose a replacement image</div>
          <figcaption>New image preview</figcaption>
        </figure>
      </div>
      <div class="site-image-editor">
        <strong>${safe(item.label)}</strong>
        ${item.key.startsWith('brand-logo-') ? `<p class="muted">This logo is used on ${safe(item.label.replace(/^Logo — /, ''))} only. Upload a transparent PNG to keep the page background visible through the logo.</p>` : ''}
        <label>Upload from Device
          <input type="file" data-site-image-file accept="image/jpeg,image/png,image/webp,image/gif">
        </label>
        <label>Choose from Library
          <select data-site-image-library>
            <option value="">Choose an existing image</option>
            ${siteImageLibrary.map((entry) => `<option value="${safe(entry.image)}">${safe(entry.name)}</option>`).join('')}
          </select>
        </label>
        <button class="button button-outline" type="button" data-import-site-image-drive ${siteImageDriveConfig.googleClientId && siteImageDriveConfig.googleDriveApiKey && siteImageDriveConfig.googleDriveAppId ? '' : 'disabled'}>Import from Google Drive</button>
        ${siteImageDriveConfig.googleClientId && siteImageDriveConfig.googleDriveApiKey && siteImageDriveConfig.googleDriveAppId ? '' : '<small>Google Drive import requires Google Picker API settings in the server .env file.</small>'}
        <label>Image URL
          <input type="text" data-site-image-url maxlength="2000" value="${safe(item.image)}" placeholder="https://… or /uploads/…">
        </label>
        <div class="site-image-actions">
          <button class="button button-dark" type="button" data-save-site-image="${safe(item.key)}">Save Image</button>
          <button class="button button-outline" type="button" data-cancel-site-image>Cancel</button>
        </div>
        <p class="site-image-message" data-site-image-message aria-live="polite"></p>
      </div>
    </article>
  `).join('');
}

function setupSiteImagesPanel() {
  const tabs = $('.admin-tabs');
  const customersPanel = $('#customersPanel');
  if (!tabs || !customersPanel) return;
  const tab = document.createElement('button');
  tab.className = 'admin-tab';
  tab.dataset.tab = 'site-images';
  tab.textContent = 'Website images';
  tabs.append(tab);
  const customersTab = tabs.querySelector('[data-tab="customers"]');
  if (customersTab) {
    const badge = document.createElement('span');
    badge.id = 'customerResetBadge';
    badge.className = 'customer-reset-badge hidden';
    badge.setAttribute('aria-live', 'polite');
    customersTab.append(badge);
  }
  customersPanel.insertAdjacentHTML('afterend', `
    <section id="siteImagesPanel" class="admin-panel hidden">
      <div class="panel-heading"><div><h2>Website images</h2><p class="muted">Upload, choose from the image library, import from Drive, or enter a URL. Images keep their original quality and are cropped to fit without stretching. Use the original full-resolution image for the sharpest result; low-resolution images cannot be made truly high-resolution by resizing.</p></div><button class="button button-outline" id="refreshSiteImages" type="button">Refresh</button></div>
      <div id="siteImagesList" class="site-image-grid"><p class="muted">Loading website images…</p></div>
    </section>`);
}

setupSiteImagesPanel();

function setupOfferBannerPanel() {
  const tabs = $('.admin-tabs');
  const siteImagesPanel = $('#siteImagesPanel');
  if (!tabs || !siteImagesPanel) return;
  const tab = document.createElement('button');
  tab.className = 'admin-tab';
  tab.dataset.tab = 'offer-banner';
  tab.textContent = 'Offers banner';
  tabs.append(tab);
  siteImagesPanel.insertAdjacentHTML('afterend', `
    <section id="offerBannerPanel" class="admin-panel hidden">
      <div class="panel-heading"><div><h2>Page offer banners</h2><p class="muted">Manage separate 766 × 139 ratio banners for each page. Updating one banner does not change the others.</p></div><button class="button button-outline" id="refreshOfferBanners" type="button">Refresh</button></div>
      <div class="offer-banner-placement-grid">
        ${[
          ['home','Home page special offer','Shown in the special offer area after New Collection on the home page.'],
          ['new-collection','New Collection page','Shown below the products on the New Collection page.'],
          ['offers','Offers page','Shown below the hero and above current promotions on the Offers page.']
        ].map(([placement,title,description]) => `
          <article class="offer-banner-placement" data-offer-banner="${placement}">
            <h3>${title}</h3>
            <p class="muted">${description}</p>
            <div class="offer-banner-preview-wrap">
              <p class="eyebrow">BANNER PREVIEW · 766 × 139</p>
              <img class="hidden" data-offer-banner-preview alt="${title} preview">
              <p class="offer-banner-empty" data-offer-banner-empty>No banner image uploaded yet.</p>
            </div>
            <div class="offer-banner-controls">
              <label>Upload or replace image<input data-offer-banner-file type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
              <small>JPEG, PNG, WebP, or GIF up to 20 MB. The image will keep its proportions in the 766 × 139 banner area.</small>
              <label class="check-label"><input data-offer-banner-active type="checkbox"> Show this banner on its page</label>
              <div class="form-actions">
                <button class="button button-dark" data-save-offer-banner type="button">Publish / Update</button>
                <button class="button button-outline" data-remove-offer-banner type="button">Remove</button>
              </div>
              <p data-offer-banner-message class="site-image-message" role="status" aria-live="polite"></p>
            </div>
          </article>
        `).join('')}
      </div>
    </section>`);
}

setupOfferBannerPanel();

function setOfferBannerPreview(card, source) {
  const preview = card.querySelector('[data-offer-banner-preview]');
  const empty = card.querySelector('[data-offer-banner-empty]');
  if (!preview || !empty) return;
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  delete preview.dataset.objectUrl;
  if (!source) {
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  if (source.startsWith('blob:')) preview.dataset.objectUrl = source;
  preview.src = source;
  preview.classList.remove('hidden');
  empty.classList.add('hidden');
}

async function loadOfferBanners() {
  const panel = $('#offerBannerPanel');
  if (!panel) return;
  panel.querySelectorAll('[data-offer-banner]').forEach((card) => {
    card.querySelector('[data-offer-banner-message]').textContent = 'Loading banner…';
  });
  try {
    currentOfferBanners = await api('/api/admin/offer-banners');
    panel.querySelectorAll('[data-offer-banner]').forEach((card) => {
      const banner = currentOfferBanners[card.dataset.offerBanner] || { image:'',active:false };
      const message = card.querySelector('[data-offer-banner-message]');
      message.classList.remove('error-text');
      card.querySelector('[data-offer-banner-active]').checked = banner.active;
      card.querySelector('[data-offer-banner-file]').value = '';
      setOfferBannerPreview(card,banner.image);
      card.querySelector('[data-remove-offer-banner]').disabled = !banner.image;
      message.textContent = banner.image ? `Last updated ${formatIST(banner.updated_at)}.` : 'Upload an image to get started.';
    });
  } catch (error) {
    panel.querySelectorAll('[data-offer-banner]').forEach((card) => {
      const message = card.querySelector('[data-offer-banner-message]');
      message.textContent = `Could not load banner: ${error.message}`;
      message.classList.add('error-text');
      setOfferBannerPreview(card,'');
    });
  }
}

$('#refreshOfferBanners')?.addEventListener('click', loadOfferBanners);
$('#offerBannerPanel')?.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-offer-banner]');
  if (!card) return;
  const saveButton = event.target.closest('[data-save-offer-banner]');
  const removeButton = event.target.closest('[data-remove-offer-banner]');
  if (!saveButton && !removeButton) return;
  const placement = card.dataset.offerBanner;
  const currentOfferBanner = currentOfferBanners[placement] || { image:'',active:false };
  if (removeButton && !currentOfferBanner.image) return;
  if (removeButton && !window.confirm(`Remove the ${card.querySelector('h3').textContent} banner?`)) return;
  const button = saveButton || removeButton;
  button.disabled = true;
  const message = card.querySelector('[data-offer-banner-message]');
  message.classList.remove('error-text');
  message.textContent = removeButton ? 'Removing banner…' : 'Saving banner…';
  try {
    let image = currentOfferBanner.image;
    let active = card.querySelector('[data-offer-banner-active]').checked;
    if (removeButton) {
      image = '';
      active = false;
    } else {
      const file = card.querySelector('[data-offer-banner-file]').files?.[0];
      if (file) image = await uploadSiteImage(file);
    }
    const result = await api(`/api/admin/offer-banners/${encodeURIComponent(placement)}`, {
      method: 'PUT',
      body: JSON.stringify({ image, active })
    });
    currentOfferBanners[placement] = result;
    card.querySelector('[data-offer-banner-file]').value = '';
    card.querySelector('[data-offer-banner-active]').checked = result.active;
    setOfferBannerPreview(card,result.image);
    card.querySelector('[data-remove-offer-banner]').disabled = !result.image;
    message.textContent = result.message;
    message.classList.remove('error-text');
    toast(result.message);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error-text');
  } finally {
    button.disabled = false;
  }
});

$('#offerBannerPanel')?.addEventListener('change', (event) => {
  if (!event.target.matches('[data-offer-banner-file]')) return;
  const card = event.target.closest('[data-offer-banner]');
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
    event.target.value = '';
    card.querySelector('[data-offer-banner-message]').textContent = 'Choose a JPEG, PNG, WebP, or GIF image.';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    event.target.value = '';
    card.querySelector('[data-offer-banner-message]').textContent = 'Image must be 20 MB or smaller.';
    return;
  }
  setOfferBannerPreview(card,URL.createObjectURL(file));
  const message = card.querySelector('[data-offer-banner-message]');
  message.textContent = `${file.name} ready to publish.`;
  message.classList.remove('error-text');
});

function setSiteImageReplacementPreview(card, source) {
  const preview = card.querySelector('[data-site-image-new-preview]');
  const placeholder = card.querySelector('[data-site-image-preview-placeholder]');
  if (!preview) return;
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  delete preview.dataset.objectUrl;
  if (!source) {
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    placeholder?.classList.remove('hidden');
    return;
  }
  if (source.startsWith('blob:')) preview.dataset.objectUrl = source;
  preview.src = source;
  preview.classList.remove('hidden');
  placeholder?.classList.add('hidden');
}

function setSiteImageMessage(card, message, isError = false) {
  const element = card.querySelector('[data-site-image-message]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error-text', isError);
  element.classList.toggle('success-text', !isError && Boolean(message));
}

function resetSiteImageCard(card) {
  const fileInput = card.querySelector('[data-site-image-file]');
  const librarySelect = card.querySelector('[data-site-image-library]');
  const urlInput = card.querySelector('[data-site-image-url]');
  if (fileInput) fileInput.value = '';
  if (librarySelect) librarySelect.value = '';
  if (urlInput) urlInput.value = card.dataset.currentImage || '';
  delete card.siteImagePendingFile;
  setSiteImageReplacementPreview(card, '');
  setSiteImageMessage(card, '');
}

function uploadSiteImage(file) {
  return fetch('/api/admin/uploads', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file
  }).then(async (response) => {
    let payload = {};
    try { payload = await response.json(); } catch (error) {}
    if (!response.ok) throw new Error(payload.error || 'Could not upload the website image.');
    return payload.image;
  });
}

function loadSiteImageScript(source, isLoaded) {
  if (isLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Drive image import could not be loaded. Check the network and Google API setup.'));
    document.head.append(script);
  });
}

async function openSiteImageDrivePicker(card, button) {
  const config = siteImageDriveConfig;
  if (!config.googleClientId || !config.googleDriveApiKey || !config.googleDriveAppId)
    throw new Error('Google Drive import is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_DRIVE_API_KEY, and GOOGLE_DRIVE_APP_ID in the server .env file.');
  button.disabled = true;
  try {
    await Promise.all([
      loadSiteImageScript('https://apis.google.com/js/api.js', () => Boolean(window.gapi)),
      loadSiteImageScript('https://accounts.google.com/gsi/client', () => Boolean(window.google?.accounts?.oauth2))
    ]);
    await new Promise((resolve, reject) => {
      window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker could not be initialized.')), timeout: 10000, ontimeout: () => reject(new Error('Google Picker initialization timed out.')) });
    });
    const accessToken = await new Promise((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response) => response.error ? reject(new Error(response.error_description || response.error)) : resolve(response.access_token),
        error_callback: (error) => reject(new Error(error.message || 'Google Drive authorization was cancelled.'))
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes('image/jpeg,image/png,image/webp,image/gif');
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.googleDriveApiKey)
      .setAppId(config.googleDriveAppId)
      .setCallback(async (data) => {
        if (data.action !== window.google.picker.Action.PICKED) return;
        try {
          const selected = data.docs?.[0];
          if (!selected?.id) throw new Error('No Drive image was selected.');
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(selected.id)}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (!response.ok) throw new Error('Google Drive could not provide this image. Check its permissions and try another file.');
          const blob = await response.blob();
          const mimeType = blob.type || selected.mimeType;
          if (!['image/jpeg','image/png','image/webp','image/gif'].includes(mimeType) || blob.size === 0)
            throw new Error('Choose a JPEG, PNG, WebP, or GIF image from Drive.');
          if (blob.size > 20 * 1024 * 1024) throw new Error('Drive image must be 20 MB or smaller.');
          const file = new File([blob], selected.name || 'drive-image', { type: mimeType });
          const fileInput = card.querySelector('[data-site-image-file]');
          const librarySelect = card.querySelector('[data-site-image-library]');
          const urlInput = card.querySelector('[data-site-image-url]');
          if (fileInput) fileInput.value = '';
          if (librarySelect) librarySelect.value = '';
          if (urlInput) urlInput.value = '';
          card.siteImagePendingFile = file;
          setSiteImageReplacementPreview(card, URL.createObjectURL(file));
          setSiteImageMessage(card, 'Drive image ready to save.');
        } catch (error) {
          setSiteImageMessage(card, error.message, true);
          toast(error.message);
        }
      })
      .build();
    picker.setVisible(true);
  } finally {
    button.disabled = false;
  }
}

$('#siteImagesPanel')?.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-site-image-card]');
  const saveButton = event.target.closest('[data-save-site-image]');
  const cancelButton = event.target.closest('[data-cancel-site-image]');
  const driveButton = event.target.closest('[data-import-site-image-drive]');
  if (!card) return;
  if (cancelButton) {
    resetSiteImageCard(card);
    return;
  }
  if (driveButton) {
    try { await openSiteImageDrivePicker(card, driveButton); }
    catch (error) { setSiteImageMessage(card, error.message, true); toast(error.message); }
    return;
  }
  if (!saveButton) return;
  saveButton.disabled = true;
  try {
    const urlInput = card.querySelector('[data-site-image-url]');
    const selectedFile = card.siteImagePendingFile || card.querySelector('[data-site-image-file]')?.files?.[0];
    const image = selectedFile ? await uploadSiteImage(selectedFile) : urlInput?.value.trim() || '';
    if (!image) throw new Error('Upload or choose an image, or enter an image URL before saving.');
    await api(`/api/admin/site-images/${encodeURIComponent(saveButton.dataset.saveSiteImage)}`, {
      method: 'PUT',
      body: JSON.stringify({ image })
    });
    await loadSiteImages();
    toast('Website image saved.');
  } catch (error) {
    setSiteImageMessage(card, error.message, true);
    toast(error.message);
  } finally {
    saveButton.disabled = false;
  }
});

$('#siteImagesPanel')?.addEventListener('change', (event) => {
  const card = event.target.closest('[data-site-image-card]');
  if (!card) return;
  if (event.target.matches('[data-site-image-file]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
      event.target.value = '';
      return setSiteImageMessage(card, 'Choose a JPEG, PNG, WebP, or GIF image.', true);
    }
    if (file.size > 20 * 1024 * 1024) {
      event.target.value = '';
      return setSiteImageMessage(card, 'Image must be 20 MB or smaller.', true);
    }
    card.siteImagePendingFile = file;
    const librarySelect = card.querySelector('[data-site-image-library]');
    const urlInput = card.querySelector('[data-site-image-url]');
    if (librarySelect) librarySelect.value = '';
    if (urlInput) urlInput.value = '';
    setSiteImageReplacementPreview(card, URL.createObjectURL(file));
    setSiteImageMessage(card, `${file.name} ready to save. Original image quality will be preserved.`);
  } else if (event.target.matches('[data-site-image-library]')) {
    const image = event.target.value;
    const fileInput = card.querySelector('[data-site-image-file]');
    const urlInput = card.querySelector('[data-site-image-url]');
    if (fileInput) fileInput.value = '';
    if (urlInput) urlInput.value = image;
    delete card.siteImagePendingFile;
    setSiteImageReplacementPreview(card, image);
    setSiteImageMessage(card, image ? 'Library image ready to save.' : '');
  }
});

$('#siteImagesPanel')?.addEventListener('input', (event) => {
  const urlInput = event.target.closest('[data-site-image-url]');
  if (!urlInput) return;
  const card = urlInput.closest('[data-site-image-card]');
  const fileInput = card?.querySelector('[data-site-image-file]');
  const librarySelect = card?.querySelector('[data-site-image-library]');
  if (fileInput) fileInput.value = '';
  if (librarySelect) librarySelect.value = '';
  if (card) {
    delete card.siteImagePendingFile;
    setSiteImageReplacementPreview(card, urlInput.value.trim());
    setSiteImageMessage(card, urlInput.value.trim() ? 'URL image preview. Save to apply it.' : '');
  }
});
$('#refreshSiteImages')?.addEventListener('click', async () => {
  try {
    await loadSiteImages();
    toast('Website images refreshed.');
  } catch (error) {
    toast(error.message);
  }
});

$('#passwordResetRequestsTable')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-password-reset-action]');
  if (!button) return;
  const action = button.dataset.passwordResetAction;
  const requestId = button.dataset.requestId;
  const request = await api('/api/admin/password-reset-requests').then((result) =>
    (result.requests || []).find((item) => String(item.id) === requestId)
  ).catch((error) => {
    toast(error.message);
    return null;
  });
  if (!request) return;
  const prompt = action === 'approve'
    ? `Only approve after verifying ${request.email} through a trusted contact method. Approve this request?`
    : `Reject the password reset request for ${request.email}?`;
  if (!window.confirm(prompt)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/password-reset-requests/${encodeURIComponent(requestId)}/${action}`, {
      method: 'POST',
      body: '{}'
    });
    await refreshPasswordResetNotifications();
    toast(result.message);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});

$('#customersTable')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-view-addresses]');
  if (!button) return;
  const row = button.closest('tr');
  const existing = row.nextElementSibling;
  if (existing?.classList.contains('customer-address-details')) {
    existing.remove();
    button.textContent = 'View addresses';
    return;
  }
  const details = document.createElement('tr');
  details.className = 'customer-address-details';
  details.innerHTML = '<td colspan="6">Loading saved addresses…</td>';
  row.after(details);
  button.disabled = true;
  try {
    const result = await api(`/api/admin/customers/${encodeURIComponent(button.dataset.viewAddresses)}/addresses`);
    details.innerHTML = `<td colspan="6"><strong>${safe(result.customer.name)} — ${result.addresses.length} saved address${result.addresses.length === 1 ? '' : 'es'}</strong>${
      result.addresses.length
        ? `<div class="customer-address-list">${result.addresses.map((address) => {
          const lines = [address.house, address.street, address.landmark, address.city, address.state, address.pin_code].filter(Boolean);
          return `<article><strong>${safe(address.recipient_name)}</strong> · ${safe(address.label)}${Number(address.is_default) ? ' · Default' : ''}<br>${safe(address.phone)}<br>${safe(lines.join(', '))}</article>`;
        }).join('')}</div>`
        : '<p>No saved addresses.</p>'
    }</td>`;
    button.textContent = 'Hide addresses';
  } catch (error) {
    details.innerHTML = `<td colspan="6" class="error-text">${safe(error.message)}</td>`;
  } finally {
    button.disabled = false;
  }
});

$('#applyOrderFilters')?.addEventListener('click', async () => {
  try { await loadOrders(); } catch (error) { toast(error.message); }
});
$('#refreshCustomers')?.addEventListener('click', async () => {
  try { await Promise.all([loadCustomers(), refreshPasswordResetNotifications()]); toast('Customer list refreshed.'); } catch (error) { toast(error.message); }
});
$('#applyCustomerFilters')?.addEventListener('click', async () => {
  try { await loadCustomers(); } catch (error) { toast(error.message); }
});

$('#ordersList')?.addEventListener('click', async (event) => {
  const updateButton = event.target.closest('[data-update-order]');
  const restockButton = event.target.closest('[data-approve-return]');
  if (!updateButton && !restockButton) return;

  try {
    if (updateButton) {
      const orderId = updateButton.dataset.updateOrder;
      const status = $(`[data-status="${orderId}"]`).value;
      const cancellationReason = $(`[data-cancel-reason="${orderId}"]`)?.value.trim() || '';
      if (status === 'Cancelled' && !cancellationReason) {
        toast('Enter a cancellation reason before cancelling this order.');
        return;
      }
      await api(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, cancellation_reason: cancellationReason })
      });
      await Promise.all([loadOrders(), loadProducts(), loadSummary()]);
      toast(status === 'Confirmed' ? 'Order confirmed and stock deducted.' : status === 'Cancelled' ? 'Order cancelled and stock adjusted.' : 'Order status updated.');
    } else {
      const orderId = restockButton.dataset.approveReturn;
      const reason = $(`[data-return-reason="${orderId}"]`)?.value.trim() || '';
      if (!reason) {
        toast('Enter the inspected return condition and approval reason before restocking.');
        return;
      }
      await api(`/api/admin/orders/${orderId}/approve-return-restock`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      await Promise.all([loadOrders(), loadProducts(), loadSummary()]);
      toast('Returned stock approved and restored.');
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#ordersList')?.addEventListener('change', (event) => {
  const statusSelect = event.target.closest('[data-status]');
  if (!statusSelect) return;
  const field = $(`[data-cancel-reason-field="${statusSelect.dataset.status}"]`);
  field?.classList.toggle('hidden', statusSelect.value !== 'Cancelled');
});

$('#refreshOrders')?.addEventListener('click', async () => {
  try {
    await loadOrders();
    await loadSummary();
    toast('Orders refreshed.');
  } catch (error) {
    toast(error.message);
  }
});

$$('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    $$('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    $('#productsPanel')?.classList.toggle('hidden', button.dataset.tab !== 'products');
    $('#collectionsPanel')?.classList.toggle('hidden', button.dataset.tab !== 'collections');
    $('#offersPanel')?.classList.toggle('hidden', button.dataset.tab !== 'offers');
    $('#ordersPanel')?.classList.toggle('hidden', button.dataset.tab !== 'orders');
    $('#customersPanel')?.classList.toggle('hidden', button.dataset.tab !== 'customers');
    $('#categoriesPanel')?.classList.toggle('hidden', button.dataset.tab !== 'categories');
    $('#adminAccessPanel')?.classList.toggle('hidden', button.dataset.tab !== 'access-management');
    $('#orderDataPanel')?.classList.toggle('hidden', button.dataset.tab !== 'order-data');
    $('#reviewsAdminPanel')?.classList.toggle('hidden', button.dataset.tab !== 'reviews');
    $('#contactSettingsPanel')?.classList.toggle('hidden', button.dataset.tab !== 'contact-settings');
    $('#siteImagesPanel')?.classList.toggle('hidden', button.dataset.tab !== 'site-images');
    $('#offerBannerPanel')?.classList.toggle('hidden', button.dataset.tab !== 'offer-banner');
  });
});

boot();