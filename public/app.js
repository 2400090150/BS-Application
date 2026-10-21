const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const sellingPrice = product => Number(product.selling_price ?? product.offer_price ?? product.price ?? 0);
function productPriceMarkup(product, price = sellingPrice(product)) {
  const originalPrice = Number(product.price || 0);
  const discount = originalPrice > price && price >= 0;
  const configuredPercentage = Number(product.discountPercent ?? product.discount_percent);
  const percentage = discount
    ? (Number.isInteger(configuredPercentage) && configuredPercentage > 0
      ? configuredPercentage
      : Math.round(((originalPrice - price) / originalPrice) * 100))
    : 0;
  return `<span class="product-prices"><span class="product-price${discount ? " sale" : ""}">${money(price)}</span>${discount ? `<span class="product-price-old">${money(originalPrice)}</span><span class="discount-label">${percentage}% OFF</span>` : ""}</span>`;
}
let products = [], activeCategory = "All", searchTerm = "", cart = {};

const safe = s => String(s ?? "").replace(/[&<>\"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function readCart() {
  try {
    cart = JSON.parse(localStorage.getItem("bs-cart") || "{}");
  } catch (e) {
    cart = {};
  }
  return cart;
}
function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(url, options = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
    ...options
  });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function loadSiteImages() {
  try {
    const response = await fetch('/api/site-images');
    if (!response.ok) throw new Error('Could not load site images.');
    const images = await response.json();
    const byKey = Object.fromEntries(images.map(({ key, image }) => [key, image]));
    window.siteImageFallback = byKey['image-fallback'] || '';
    document.querySelectorAll('[data-site-image]').forEach((element) => {
      const image = byKey[element.dataset.siteImage];
      if (image) element.src = image;
    });
  } catch (error) {
    console.error(error);
  }
}

window.loadAvailableCategories = async () => api("/api/categories");

async function loadHomeCategoryFilters() {
  const container = $("#categories");
  if (!container) return;
  try {
    const [categories, homepageProducts] = await Promise.all([
      window.loadAvailableCategories(),
      api("/api/products?homepage=1")
    ]);
    const homepageCategories = new Set(homepageProducts.map(product => product.category));
    container.replaceChildren();
    const addFilter = (name, label, active = false) => {
      const button = document.createElement("button");
      button.className = `pill${active ? " active" : ""}`;
      button.dataset.category = name;
      button.textContent = label;
      container.append(button);
    };
    addFilter("All", "All pieces", true);
    categories.filter(category => homepageCategories.has(category.name))
      .forEach(category => addFilter(category.name, category.name));
  } catch (error) {
    console.error("Product categories could not be loaded:", error);
  }
}

function getCartLines() {
  ensureCartLoaded();
  return Object.entries(cart)
    .map(([id, qty]) => ({ product: products.find(p => p.id === Number(id)), qty: Number(qty) }))
    .filter(item => item.product);
}

function saveCart() {
  localStorage.setItem("bs-cart", JSON.stringify(cart));
  renderCartCount();
  renderCart();
}

function ensureCartLoaded() {
  if (!Object.keys(cart).length) {
    const stored = readCart();
    cart = stored;
  }
}

function renderCartCount() {
  const countEl = $("#cartCount");
  if (!countEl) return;
  const total = getCartLines().reduce((sum, item) => sum + item.qty, 0);
  countEl.textContent = total;
}

function renderCart() {
  const drawerCount = $("#drawerCount");
  const cartSubtotal = $("#cartSubtotal");
  const checkoutTotal = $("#checkoutTotal");
  const cartItems = $("#cartItems");
  const checkoutButton = $("#checkoutButton");
  if (!drawerCount || !cartSubtotal || !checkoutTotal || !cartItems || !checkoutButton) return;

  const lines = getCartLines();
  const totalQty = lines.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = lines.reduce((sum, item) => sum + sellingPrice(item.product) * item.qty, 0);
  const hasUnavailableItems = lines.some(({ product, qty }) => product.out_of_stock || product.stock < 1 || qty > product.stock);

  drawerCount.textContent = `(${totalQty})`;
  cartSubtotal.textContent = money(subtotal);
  checkoutTotal.textContent = money(subtotal);

  cartItems.innerHTML = lines.length
    ? lines.map(({ product: p, qty }) => `
        <div class="cart-line">
          <img src="${safe(p.image)}" alt="${safe(p.name)}">
          <div>
            <h3>${safe(p.name)}</h3>
            <p>${productPriceMarkup(p)}</p>
            <div class="qty-control">
              <button data-qty="${p.id}" data-delta="-1" aria-label="Decrease quantity">−</button>
              <span>${qty}</span>
              <button data-qty="${p.id}" data-delta="1" aria-label="Increase quantity" ${p.out_of_stock || qty >= p.stock ? "disabled" : ""}>+</button>
            </div>
          </div>
          <button class="remove-item" data-remove="${p.id}" aria-label="Remove ${safe(p.name)}">×</button>
        </div>`).join("")
    : '<div class="empty-state">Your bag is waiting for something lovely.</div>';

  checkoutButton.disabled = !lines.length || hasUnavailableItems;
}

function openCart() {
  const overlay = $("#overlay");
  const drawer = $("#cartDrawer");
  if (!overlay || !drawer) return;
  overlay.classList.remove("hidden");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  const overlay = $("#overlay");
  const drawer = $("#cartDrawer");
  if (!overlay || !drawer) return;
  overlay.classList.add("hidden");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function addToCart(productId) {
  const p = products.find(item => item.id === Number(productId));
  if (!p) return;
  if (p.out_of_stock || p.stock < 1) {
    toast("This product is out of stock.");
    return;
  }
  if ((cart[productId] || 0) >= p.stock) {
    toast("Available stock limit reached.");
    return;
  }
  cart[productId] = (cart[productId] || 0) + 1;
  saveCart();
  toast("Added to your bag.");
}

function filteredProducts() {
  let list = products.filter(p => (activeCategory === "All" || p.category === activeCategory) && (!searchTerm || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(searchTerm.toLowerCase())));
  const sort = $("#sort")?.value || "featured";
  if (sort === "price-asc") list.sort((a, b) => sellingPrice(a) - sellingPrice(b));
  if (sort === "price-desc") list.sort((a, b) => sellingPrice(b) - sellingPrice(a));
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderProductCardGrid(container, items, options = {}) {
  const { emptyText = "No pieces found.", showOfferPrice = false } = options;
  if (!container) return;

  container.innerHTML = (items && items.length)
    ? items.map(item => {
        const product = item.product || item;
        const productId = product.id;
        const name = product.name || "Untitled product";
        const category = product.category || "";
        const fallbackImage = window.siteImageFallback || "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=700&q=80";
        const image = product.image || fallbackImage;
        const stock = Number(product.stock || 0);
        const outOfStock = !!product.out_of_stock || stock < 1;
        const featured = !!(product.featured || item.featured);
        const price = Number(product.price || 0);
        const currentSellingPrice = showOfferPrice
          ? Number(item.selling_price ?? product.selling_price ?? item.offer_price ?? product.offer_price ?? price)
          : sellingPrice(product);
        const offerMarkup = productPriceMarkup(product, currentSellingPrice);

        return `
          <article class="product-card" data-product-id="${productId}" tabindex="0">
            <div class="product-image">
              <img src="${safe(image)}" alt="${safe(name)}" loading="lazy" onerror="this.onerror=null;this.src='${safe(fallbackImage)}'">
              ${featured ? '<span class="product-badge">Featured</span>' : ""}
              ${outOfStock ? '<span class="product-badge out-of-stock-badge">Out of stock</span>' : ""}
              <button class="quick-add" data-add="${productId}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Out of stock" : (showOfferPrice ? "Shop now" : "Add to bag +")}</button>
            </div>
            <div class="product-meta">
              <div>
                <h3>${safe(name)}</h3>
                <span class="product-category">${safe(category)}</span>
              </div>
              ${offerMarkup}
            </div>
            <div class="stock-note">${outOfStock ? "Out of stock" : (stock <= 5 ? `Only ${stock} left` : "Ready to order")}</div>
          </article>`;
      }).join("")
    : `<div class="empty-state">${emptyText}</div>`;
}

function renderProducts() {
  const grid = $("#productGrid");
  if (!grid) return;
  const visibleProducts = filteredProducts();
  const emptyText = $("#shop") && products.length === 0
    ? "Our homepage collection is being curated. Please check back soon."
    : "No pieces found. Try another category or search.";
  renderProductCardGrid(grid, visibleProducts, { emptyText });
}

function renderCollectionGrid(items = []) {
  const grid = $("#newCollectionGrid");
  if (!grid) return;
  renderProductCardGrid(grid, items, { emptyText: "No new arrivals yet. Check back soon." });
}

function renderBannerList(banners = []) {
  const list = $("#promoBannerList");
  if (!list) return;
  const section = list.closest(".promo-banner-section");
  if (section) section.classList.toggle("hidden", !banners.length);
  list.innerHTML = banners.length
    ? banners.map(banner => `
      <article class="promo-banner-card">
        <img src="${safe(banner.image || "")}" alt="${safe(banner.title || "Offer banner")}" loading="lazy">
        <div class="promo-content">
          <p class="eyebrow">${safe(banner.title || "Special offer")}</p>
          <h3>${safe(banner.title || "Offer")}</h3>
          <p>${safe(banner.description || "Curated savings for your next purchase.")}</p>
          <div class="promo-meta">
            ${banner.start_date ? `<span>Starts ${safe(banner.start_date)}</span>` : ""}
            ${banner.end_date ? `<span>Ends ${safe(banner.end_date)}</span>` : ""}
          </div>
          <a class="button button-dark" href="${safe(banner.button_link || "/products")}">${safe(banner.button_text || "Shop offers")}</a>
        </div>
      </article>
    `).join("")
    : "";
}

function renderSpecialOfferGrid(items = []) {
  const grid = $("#specialOfferGrid");
  if (!grid) return;
  renderProductCardGrid(grid, items, { emptyText: "There are no active special-offer sarees right now.", showOfferPrice: true });
}

function renderOfferBanner(sectionSelector, imageSelector, banner = {}) {
  const section = $(sectionSelector);
  const image = $(imageSelector);
  if (!section || !image) return;
  const visible = Boolean(banner.active && banner.image);
  section.classList.toggle("hidden", !visible);
  if (visible) image.src = banner.image;
  else image.removeAttribute("src");
}

function syncHomepageModuleVisibility(data = {}) {
  const collectionSection = $("#newCollectionSection");
  const specialOfferSection = $("#specialOfferSection");
  if (collectionSection) collectionSection.classList.toggle("hidden", !(data.collection || []).length);
  const offerBanners = data.offerBanners || { home: data.offerBanner };
  renderOfferBanner("#offersBannerSection", "#homeOfferBannerImage", offerBanners.home || {});
  renderOfferBanner("#collectionOfferBannerSection", "#collectionOfferBannerImage", offerBanners.newCollection || {});
  renderOfferBanner("#offersPageBannerSection", "#offersPageBannerImage", offerBanners.offers || {});
  if (specialOfferSection) specialOfferSection.classList.toggle("hidden", !(data.specialOffers || []).length);
}

async function loadHomepageData() {
  const hasCollection = !!$("#newCollectionGrid");
  const hasBanners = !!$("#promoBannerList");
  const hasSpecialOffers = !!$("#specialOfferGrid");
  const hasOfferBanner = !!$("#offersBannerSection");
  const hasPageBanners = !!$("#collectionOfferBannerSection, #offersPageBannerSection");
  if (!hasCollection && !hasBanners && !hasSpecialOffers && !hasOfferBanner && !hasPageBanners) return;

  try {
    const data = await api("/api/homepage");
    if (hasCollection) renderCollectionGrid(data.collection || []);
    if (hasBanners) renderBannerList(data.banners || []);
    if (hasSpecialOffers) renderSpecialOfferGrid(data.specialOffers || []);
    syncHomepageModuleVisibility(data);
  } catch (error) {
    if (hasCollection) $("#newCollectionGrid").innerHTML = '<div class="empty-state">The new collection could not load right now.</div>';
    if (hasBanners) {
      $("#promoBannerList").innerHTML = '<div class="empty-state">Offer banners are unavailable right now.</div>';
      $("#promoBannerList").closest(".promo-banner-section")?.classList.remove("hidden");
    }
    if (hasSpecialOffers) $("#specialOfferGrid").innerHTML = '<div class="empty-state">Special offers are unavailable right now.</div>';
    syncHomepageModuleVisibility({ collection: [], banners: [], specialOffers: [], offerBanner: null });
  }
}

window.renderProductCardGrid = renderProductCardGrid;
window.renderCollectionGrid = renderCollectionGrid;
window.renderBannerList = renderBannerList;
window.renderSpecialOfferGrid = renderSpecialOfferGrid;
window.loadHomepageData = loadHomepageData;

async function loadProducts() {
  try {
    products = await api($("#shop") ? "/api/products?homepage=1" : "/api/products");
    if (!$("#collectionFilters")) renderProducts();
    renderCart();
    renderCartCount();
  } catch (e) {
    const grid = $("#productGrid");
    if (grid) grid.innerHTML = '<div class="empty-state">The collection could not load. Please refresh the page.</div>';
  }
}

function syncCartFromStorage() {
  readCart();
  renderCart();
  renderCartCount();
}

function renderRelatedProducts(currentProduct) {
  const relatedGrid = $("#relatedGrid");
  if (!relatedGrid) return;
  const related = products
    .filter(p => p.id !== currentProduct.id && p.category === currentProduct.category)
    .slice(0, 4);

  relatedGrid.innerHTML = related.length
    ? related.map(p => `
      <article class="product-card" data-product-id="${p.id}" tabindex="0">
        <div class="product-image">
          <img src="${safe(p.image || "")}" alt="${safe(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${safe(window.siteImageFallback || "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=700&q=80")}'">
          ${p.featured ? '<span class="product-badge">Featured</span>' : ""}
          ${p.out_of_stock || p.stock < 1 ? '<span class="product-badge out-of-stock-badge">Out of stock</span>' : ""}
          <button class="quick-add" data-add="${p.id}" ${p.out_of_stock || p.stock < 1 ? "disabled" : ""}>${p.out_of_stock || p.stock < 1 ? "Out of stock" : "Add to bag +"}</button>
        </div>
        <div class="product-meta">
          <div>
            <h3>${safe(p.name)}</h3>
            <span class="product-category">${safe(p.category)}</span>
          </div>
          ${productPriceMarkup(p)}
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">No matching pieces yet.</div>';
}

async function loadProductDetail() {
  const detailImage = $("#detailImage");
  const detailName = $("#detailName");
  const detailPrice = $("#detailPrice");
  const detailCategory = $("#detailCategory");
  const detailDescription = $("#detailDescription");
  const detailStock = $("#detailStock");
  const detailAddToBag = $("#detailAddToBag");
  if (!detailImage || !detailName || !detailPrice || !detailCategory || !detailDescription || !detailStock || !detailAddToBag) return;

  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id"));
  if (!Number.isInteger(id)) {
    detailName.textContent = "Product not found";
    detailDescription.textContent = "The requested item could not be located.";
    return;
  }

  try {
    products = await api("/api/products");
    const product = await api(`/api/products/${id}`);
    detailImage.src = product.image || "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=900&q=80";
    detailImage.alt = product.name;
    detailName.textContent = product.name;
    detailPrice.innerHTML = productPriceMarkup(product);
    detailCategory.textContent = product.category;
    detailDescription.textContent = product.description || "A handcrafted piece from the BS Handlooms collection.";
    const unavailable = product.out_of_stock || product.stock < 1;
    detailStock.textContent = unavailable ? "Out of stock" : (product.stock <= 5 ? `Only ${product.stock} left` : "In stock");
    detailStock.classList.toggle("low-stock", !unavailable && product.stock <= 5);
    detailAddToBag.disabled = unavailable;
    detailAddToBag.textContent = unavailable ? "Out of stock" : "Add to bag";
    renderRelatedProducts(product);
    renderCart();
    renderCartCount();
    detailAddToBag.onclick = () => {
      if (product.out_of_stock || product.stock < 1) return;
      addToCart(product.id);
      openCart();
    };
  } catch (error) {
    detailName.textContent = "Product unavailable";
    detailDescription.textContent = error.message || "The collection could not load right now.";
  }
}

function bindSharedStorefront() {
  const productGrid = $("#productGrid");
  if (productGrid) {
    productGrid.addEventListener("click", event => {
      const addButton = event.target.closest("[data-add]");
      if (addButton) {
        event.preventDefault();
        const id = Number(addButton.dataset.add);
        addToCart(id);
        return;
      }
      const productCard = event.target.closest("[data-product-id]");
      if (productCard) {
        const id = Number(productCard.dataset.productId);
        if (!Number.isNaN(id)) {
          window.location.href = `/product?id=${id}`;
        }
      }
    });
  }

  const relatedGrid = $("#relatedGrid");
  if (relatedGrid) {
    relatedGrid.addEventListener("click", event => {
      const addButton = event.target.closest("[data-add]");
      if (addButton) {
        event.preventDefault();
        addToCart(Number(addButton.dataset.add));
        return;
      }
      const productCard = event.target.closest("[data-product-id]");
      if (productCard) {
        const id = Number(productCard.dataset.productId);
        if (!Number.isNaN(id)) {
          window.location.href = `/product?id=${id}`;
        }
      }
    });
  }

  const detailAddToBag = $("#detailAddToBag");
  if (detailAddToBag) {
    detailAddToBag.addEventListener("click", () => {
      const params = new URLSearchParams(window.location.search);
      const id = Number(params.get("id"));
      if (Number.isInteger(id)) {
        addToCart(id);
        openCart();
      }
    });
  }

  const categories = $("#categories");
  if (categories) {
    categories.addEventListener("click", event => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      activeCategory = button.dataset.category;
      categories.querySelectorAll(".pill").forEach(item => item.classList.toggle("active", item === button));
      renderProducts();
    });
  }

  const sort = $("#sort");
  const hasCuratedCollectionGrid = Boolean($("#collectionFilters"));
  if (sort && !hasCuratedCollectionGrid) sort.addEventListener("change", renderProducts);

  const searchToggle = $("#searchToggle");
  const searchRow = $("#searchRow");
  const searchInput = $("#searchInput");
  const clearSearch = $("#clearSearch");
  if (searchToggle && searchRow && searchInput) {
    searchToggle.addEventListener("click", () => {
      searchRow.classList.toggle("hidden");
      if (!searchRow.classList.contains("hidden")) searchInput.focus();
    });
  }
  if (searchInput && !hasCuratedCollectionGrid) {
    searchInput.addEventListener("input", event => {
      searchTerm = event.target.value.trim();
      renderProducts();
    });
  }
  if (clearSearch && searchInput && !hasCuratedCollectionGrid) {
    clearSearch.addEventListener("click", () => {
      searchInput.value = "";
      searchTerm = "";
      renderProducts();
    });
  }

  const cartToggle = $("#cartToggle");
  if (cartToggle) cartToggle.addEventListener("click", openCart);

  const closeCartButton = $("#closeCart");
  if (closeCartButton) closeCartButton.addEventListener("click", closeCart);

  const overlay = $("#overlay");
  if (overlay) overlay.addEventListener("click", closeCart);

  const menuToggle = $("#menuToggle");
  const nav = $("#nav");
  if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => nav.classList.toggle("open"));
  }
  if (nav) {
    nav.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => nav.classList.remove("open"));
    });
  }

  const checkoutButton = $("#checkoutButton");
  if (checkoutButton) {
    checkoutButton.addEventListener("click", () => {
      const lines = getCartLines();
      if (!lines.length) return;
      closeCart();
      const checkoutModal = $("#checkoutModal");
      const checkoutMessage = $("#checkoutMessage");
      if (checkoutModal) checkoutModal.classList.remove("hidden");
      if (checkoutMessage) {
        checkoutMessage.textContent = "";
        checkoutMessage.className = "";
      }
      const overlayVisible = $("#overlay");
      if (overlayVisible) {
        overlayVisible.classList.remove("hidden");
      }
      document.body.style.overflow = "hidden";
    });
  }

  const closeCheckoutButton = $("#closeCheckout");
  if (closeCheckoutButton) {
    closeCheckoutButton.addEventListener("click", () => {
      const checkoutModal = $("#checkoutModal");
      const overlayVisible = $("#overlay");
      if (checkoutModal) checkoutModal.classList.add("hidden");
      if (overlayVisible) overlayVisible.classList.add("hidden");
      document.body.style.overflow = "";
    });
  }

  const checkoutForm = $("#checkoutForm");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget || document.getElementById("checkoutForm");
      const btn = event.submitter || (form ? form.querySelector('button[type="submit"]') : null);
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Placing order…";
      }
      const checkoutMessage = $("#checkoutMessage");
      if (checkoutMessage) checkoutMessage.textContent = "";
      try {
        readCart();
        const lines = getCartLines();
        if (!lines.length) {
          throw new Error("Please complete all delivery details and add at least one item.");
        }

        const formData = new FormData(form || event.target);
        const customer = Object.fromEntries(["name", "email", "phone", "address"].map(key => [key, String(formData.get(key) || "").trim()]));
        const missing = ["name", "email", "phone", "address"].filter(key => !customer[key]);
        if (missing.length) {
          throw new Error("Please complete all delivery details and add at least one item.");
        }

        const result = await api("/api/orders", {
          method: "POST",
          body: JSON.stringify({
            customer,
            paymentMethod: formData.get("paymentMethod") || "Pay on delivery",
            items: lines.map(item => ({ id: item.product.id, quantity: item.qty }))
          })
        });
        cart = {};
        saveCart();
        if (form && typeof form.reset === "function") form.reset();
        if (checkoutMessage) {
          checkoutMessage.innerHTML = `<div class="success-box"><strong>Thank you — your order is recorded.</strong><br>Order number: <strong>#${result.orderId}</strong><br>Total: <strong>${money(result.total)}</strong><br>BS Handlooms can follow up to confirm your order and delivery.</div>`;
        }
        toast("Order placed successfully.");
        setTimeout(() => {
          const checkoutModal = $("#checkoutModal");
          const overlayVisible = $("#overlay");
          if (checkoutModal) checkoutModal.classList.add("hidden");
          if (overlayVisible) overlayVisible.classList.add("hidden");
          document.body.style.overflow = "";
        }, 5000);
      } catch (err) {
        if (checkoutMessage) checkoutMessage.innerHTML = `<p class="error-text">${safe(err.message)}</p>`;
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Place order ↗";
        }
      }
    });
  }

  const newsletterForm = $("#newsletterForm");
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", event => {
      event.preventDefault();
      const newsletterMessage = $("#newsletterMessage");
      if (newsletterMessage) newsletterMessage.textContent = "Thank you for your interest in BS Handlooms. Newsletter signup needs an email service to be connected.";
      event.currentTarget.reset();
    });
  }

  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  const existingCheckoutForm = $("#checkoutForm");
  if (existingCheckoutForm) {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      if (d.authenticated && d.customer) {
        existingCheckoutForm.elements.name.value = d.customer.name || "";
        existingCheckoutForm.elements.email.value = d.customer.email || "";
        existingCheckoutForm.elements.phone.value = d.customer.phone || "";
        existingCheckoutForm.elements.address.value = d.customer.address || "";
      }
    }).catch(() => {});
  }

  const cartItems = $("#cartItems");
  if (cartItems) {
    cartItems.addEventListener("click", event => {
      const removeButton = event.target.closest("[data-remove]");
      const qtyButton = event.target.closest("[data-qty]");
      if (removeButton) {
        delete cart[removeButton.dataset.remove];
        saveCart();
      }
      if (qtyButton) {
        const id = qtyButton.dataset.qty;
        const delta = Number(qtyButton.dataset.delta);
        const p = products.find(item => item.id === Number(id));
        cart[id] = (cart[id] || 0) + delta;
        if (cart[id] <= 0) delete cart[id];
        else if (p && (p.out_of_stock || cart[id] > p.stock)) cart[id] = p.out_of_stock ? 0 : p.stock;
        if (p?.out_of_stock) delete cart[id];
        saveCart();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSiteImages();
  await loadHomeCategoryFilters();
  readCart();
  bindSharedStorefront();
  renderCartCount();
  renderCart();
  if (sessionStorage.getItem("bs-profile-saved") === "true") {
    sessionStorage.removeItem("bs-profile-saved");
    toast("Your profile has been saved.");
  }
  loadHomepageData();
  if ($("#offersBannerSection, #collectionOfferBannerSection, #offersPageBannerSection")) window.setInterval(loadHomepageData, 15000);
  if ($("#productGrid")) loadProducts();
  if ($("#detailImage")) loadProductDetail();
});