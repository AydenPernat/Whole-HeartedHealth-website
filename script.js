const menuButton = document.getElementById('menu-toggle');
const bar = document.getElementById('bar');
const nav = document.getElementById('navbar');

function setMenuState(isOpen) {
    if (!menuButton || !bar || !nav) return;
    nav.classList.toggle('active', isOpen);
    document.body.classList.toggle('nav-open', isOpen);
    menuButton.classList.toggle('is-open', isOpen);
    bar.classList.toggle('fa-bars', !isOpen);
    bar.classList.toggle('fa-xmark', isOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    document.querySelector('main')?.toggleAttribute('inert', isOpen);
    document.querySelector('footer')?.toggleAttribute('inert', isOpen);
    if (!isOpen) menuButton.focus();
}

if (menuButton && bar && nav) {
    menuButton.addEventListener('click', () => {
        setMenuState(!nav.classList.contains('active'));
    });

    nav.addEventListener('click', event => {
        if (event.target.closest('a[href]')) setMenuState(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && nav.classList.contains('active')) {
            const focusable = [menuButton, ...nav.querySelectorAll('a[href]')];
            const current = focusable.indexOf(document.activeElement);
            if ((event.shiftKey && current <= 0) || (!event.shiftKey && current === focusable.length - 1)) {
                event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
            }
        }
        if (event.key === 'Escape' && nav.classList.contains('active')) {
            setMenuState(false);
        }
    });
}

// Handle missing images once, including dynamically rendered product cards.
document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
    img.dataset.fallback = 'true';
    img.src = 'img/logo3.png';
    img.alt = 'Image unavailable';
}, true);

// Product Database
const products = [];
let productsUnavailable = false;
let eventsUnavailable = false;

function formatMoney(amount) {
    const value = Number(amount) || 0;
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}
// Cart Management System
class Cart {
    constructor() {
        this.items = this.loadCart();
    }
    loadCart() {
        const saved = localStorage.getItem('cart');
        try { return saved ? JSON.parse(saved) : []; } catch (err) { return []; }
    }
    saveCart() {
        localStorage.setItem('cart', JSON.stringify(this.items));
    }
    addItem(product, quantity = 1, options = {}) {
        quantity = Number(quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
            return false;
        }
        const size = String(options.size || '').trim();
        const lineKey = `${product.id}:${size}`;
        const existingItem = this.items.find(item => (item.lineKey || `${item.id}:${item.size || ''}`) === lineKey);
        
        if (existingItem) {
            if (existingItem.quantity + quantity > 999) return false;
            existingItem.quantity += quantity;
        } else {
            this.items.push({
                ...product,
                size,
                lineKey,
                quantity: quantity
            });
        }
        this.saveCart();
        return true;
    }
    removeItem(lineKey) {
        this.items = this.items.filter(item => (item.lineKey || `${item.id}:${item.size || ''}`) !== String(lineKey));
        this.saveCart();
    }
    updateQuantity(lineKey, quantity) {
        quantity = Number(quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return false;
        const item = this.items.find(item => (item.lineKey || `${item.id}:${item.size || ''}`) === String(lineKey));
        if (item) {
            item.quantity = quantity;
            this.saveCart();
        }
        return !!item;
    }
    getTotal() {
        return this.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    }
    getCartCount() {
        return this.items.reduce((total, item) => total + item.quantity, 0);
    }
    clear() {
        this.items = [];
        this.saveCart();
    }
}
// Initialize cart
const cart = new Cart();
// ---------- Helper: detect if we are on the wishlist page ----------
function isWishlistPage() {
    return window.location.pathname.endsWith('wishlist.html') ||
           document.querySelector('#wishlist') !== null;
}
// Add to Cart functionality
function setupAddToCartButtons() {
    // Setup for product containers
    const products_elements = document.querySelectorAll('.pro:not([data-skip-product-behavior])');
    products_elements.forEach((product, index) => {
        // Make the product box clickable to go to sproduct
        product.style.cursor = 'pointer';
        if (product.querySelector('img')) product.querySelector('img').style.cursor = 'pointer';
        
        product.addEventListener('click', (e) => {
            if (e.target.classList.contains('cart') || e.target.closest('a') || 
                e.target.classList.contains('btn-wishlist') || e.target.classList.contains('wishlist-remove-btn')) {
                return;
            }
            const dataId = parseInt(product.dataset.productId || '', 10);
            const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : products[index % products.length]?.id;
            if (!productId) return;
            window.location.href = `sproduct.html?id=${productId}`;
        });
        
        // Handle cart button separately
        const cartBtn = product.querySelector('.cart') || product.querySelector('[data-cart-btn]');
        if (cartBtn) {
            cartBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dataId = parseInt(product.dataset.productId || '', 10);
                const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : products[index % products.length]?.id;
                const prod = products.find(p => p.id === productId);
                if (prod) {
                    cart.addItem(prod);
                    showNotification(`${prod.name} added to cart!`);
                    updateCartCount();
                }
            };
        }
        // ===== ONLY add the "+" wishlist button if we are NOT on the wishlist page =====
        if (!isWishlistPage()) {
            let wishBtn = product.querySelector('.btn-wishlist');
            if (!wishBtn) {
                wishBtn = document.createElement('button');
                wishBtn.className = 'btn-wishlist';
                wishBtn.type = 'button';
                wishBtn.title = 'Add to wishlist';
                wishBtn.innerHTML = '+';
                wishBtn.style.cssText = 'position:absolute; top:10px; right:48px; border:none; background:transparent; font-size:20px; cursor:pointer; color:var(--text-muted); font-weight:700;';
                
                const dataId = parseInt(product.dataset.productId || '', 10);
                const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : products[index % products.length]?.id;
                wishBtn.dataset.productId = productId;
                product.appendChild(wishBtn);
            }
            wishBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!isSignedIn()) {
                    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
                    window.location.href = `signin.html?redirect=${redirectUrl}`;
                    return;
                }
                const productId = parseInt(ev.currentTarget.dataset.productId);
                ev.currentTarget.classList.add('pulse');
                setTimeout(() => ev.currentTarget.classList.remove('pulse'), 220);
                toggleWishlist(productId);
            });
        }
    });
    // Update wishlist button states (only relevant on non-wishlist pages)
    if (!isWishlistPage()) {
        updateWishlistButtons();
    }
}
function handleAddToCart(e) {
    e.preventDefault();
    const productElement = this.closest('.pro');
    if (productElement) {
        const productName = productElement.querySelector('h5, h4') ? productElement.querySelector('h5, h4').textContent : 'Product';
        const productId = parseInt(productElement.dataset.productId) || 1;
        const product = products.find(p => p.id === productId);
        
        if (product) {
            cart.addItem(product);
            showNotification(`${product.name} added to cart!`);
            updateCartCount();
        }
    }
}
function showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = 'site-notification';
    
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
}
// Update header counts (cart + wishlist)
function updateCartCount() {
    // --- cart badge ---
    const count = cart.getCartCount();
    const cartIcon = document.querySelector('#lg-bag a');
    if (cartIcon) {
        let badge = cartIcon.querySelector('.cart-count');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'cart-count';
                cartIcon.style.position = 'relative';
                cartIcon.appendChild(badge);
            }
            badge.textContent = count;
            badge.style.display = 'flex';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    // --- wishlist badge (keeps same behavior and size as cart) ---
    const wCount = getWishlist().length;
    const wishIcon = document.querySelector('#nav-wishlist a');
    if (wishIcon) {
        let wBadge = wishIcon.querySelector('.wishlist-count');
        if (wCount > 0) {
            if (!wBadge) {
                wBadge = document.createElement('span');
                wBadge.className = 'wishlist-count';
                wishIcon.style.position = 'relative';
                wishIcon.appendChild(wBadge);
            }
            wBadge.textContent = wCount;
            wBadge.style.display = 'flex';
        } else if (wBadge) {
            wBadge.style.display = 'none';
        }
    }
}
// Display cart items on cart page
function displayCartItems() {
    const cartTable = document.querySelector('#cart tbody');
    if (!cartTable) return;
    cartTable.innerHTML = '';
    if (cart.items.length === 0) {
        cartTable.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Your cart is empty</td></tr>';
        updateCartTotals();
        return;
    }
    cart.items.forEach(item => {
        const row = document.createElement('tr');
        const subtotal = item.price * item.quantity;
        
        row.innerHTML = `
            <td><button type="button" class="cart-remove" data-line-key="${escapeHTML(item.lineKey || `${item.id}:${item.size || ''}`)}" aria-label="Remove ${escapeHTML(item.name)}"><i class="far fa-times-circle"></i></button></td>
            <td><img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.name)}" style="width: 50px;"></td>
            <td>${escapeHTML(item.name)}${item.size ? `<small class="cart-variant">Size: ${escapeHTML(item.size)}</small>` : ''}</td>
            <td>$${formatMoney(item.price)}</td>
            <td><input class="cart-quantity" data-line-key="${escapeHTML(item.lineKey || `${item.id}:${item.size || ''}`)}" type="number" value="${item.quantity}" min="1" max="999"></td>
            <td>$${formatMoney(subtotal)}</td>
        `;
        
        cartTable.appendChild(row);
    });
    cartTable.querySelectorAll('.cart-remove').forEach(button => button.addEventListener('click', () => removeFromCart(button.dataset.lineKey)));
    cartTable.querySelectorAll('.cart-quantity').forEach(input => input.addEventListener('change', () => updateCartQuantity(input.dataset.lineKey, input.value)));
    updateCartTotals();
}
function removeFromCart(lineKey) {
    cart.removeItem(lineKey);
    displayCartItems();
    updateCartCount();
}
function updateCartQuantity(lineKey, quantity) {
    if (!cart.updateQuantity(lineKey, quantity)) {
        showNotification('Choose a whole quantity from 1 to 999.');
    }
    displayCartItems();
    updateCartCount();
}
function updateCartTotals() {
    const subtotal = cart.getTotal();
    const total = subtotal;
    
    const cartTotals = document.querySelector('#subtotal');
    if (cartTotals) {
        const subtotalCell = cartTotals.querySelector('table tr:first-child td:last-child');
        const totalCell = cartTotals.querySelector('table tr:last-child td:last-child');
        const savedRow = document.querySelector('#saved-row');
        
        if (subtotalCell) subtotalCell.textContent = `$ ${formatMoney(subtotal)}`;
        if (totalCell) totalCell.textContent = `$ ${formatMoney(total)}`;
        
        if (savedRow) savedRow.remove();
    }
}
function isSignedIn() {
    return !!localStorage.getItem('w_user');
}
function getCurrentUser() {
    const u = localStorage.getItem('w_user');
    try { return u ? JSON.parse(u) : null; } catch (err) { return null; }
}
async function signOutUser() {
    const response = await fetch('/api/auth/signout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    localStorage.removeItem('w_user');
    localStorage.removeItem('w_token');
    localStorage.removeItem('w_wishlist');
    updateAuthUI();
}

function isSuperiorAccount() {
    const user = getCurrentUser();
    return !!(user && ['admin', 'owner'].includes(user.role));
}

async function fetchGlobalProducts() {
    productsUnavailable = false;
    try {
        const res = await fetch('/api/products');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.products)) {
                products.length = 0;
                data.products.forEach(p => products.push(p));
                return data.products;
            }
        }
    } catch (err) {}
    productsUnavailable = true;
    products.length = 0;
    return products;
}

async function fetchGlobalEvents() {
    eventsUnavailable = false;
    try {
        const res = await fetch('/api/events');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.events)) {
                window.globalEvents = data.events;
                return data.events;
            }
        }
    } catch (err) {}
    eventsUnavailable = true;
    window.globalEvents = [];
    return [];
}

function getAllEvents() {
    if (Array.isArray(window.globalEvents)) {
        return window.globalEvents;
    }
    return [];
}

function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderCatalogCards() {
    const grids = document.querySelectorAll('#product1 .pro-container:not(#events-grid)');
    grids.forEach((grid) => {
        grid.innerHTML = products.length ? products.map(p => `
            <div class="pro" data-product-id="${escapeHTML(p.id)}">
                <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}">
                <div class="des">
                    <span>${escapeHTML(p.category || 'Product')}</span>
                    <h5><a href="sproduct.html?id=${encodeURIComponent(p.id)}">${escapeHTML(p.name)}</a></h5>
                    <h4>$${formatMoney(p.price)}</h4>
                </div>
                <a href="#" aria-label="Add ${escapeHTML(p.name)} to cart"><i class="fa-solid fa-cart-shopping cart"></i></a>
            </div>
        `).join('') : productsUnavailable ? '<p role="alert">The collection could not be loaded. Please refresh to try again.</p>' : '<p>Our collection is taking shape. Check back soon, or contact us with a question.</p>';
    });
}

function renderEventsPage() {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    const events = getAllEvents().filter(ev => !Number.isFinite(Date.parse(ev.date)) || Date.parse(ev.date) >= Date.now() - 86400000);
    grid.innerHTML = events.length ? events.map(ev => `
        <article class="pro" data-skip-product-behavior="true">
            <a href="event-detail.html?id=${encodeURIComponent(ev.id)}" style="text-decoration:none; color:inherit; display:block;">
                <div class="des" style="padding-top:0;">
                    <h5 style="font-size:20px; margin-bottom:10px;">${escapeHTML(ev.name)}</h5>
                </div>
                <img src="${escapeHTML(ev.image)}" alt="${escapeHTML(ev.name)}">
                <div class="des">
                    <span>${escapeHTML(ev.date)}</span>
                    <h5>${escapeHTML(ev.location)}</h5>
                </div>
            </a>
        </article>
    `).join('') : eventsUnavailable ? '<p role="alert">Events could not be loaded. Please refresh to try again.</p>' : '<p>No upcoming events are scheduled. Please check back later.</p>';
}

function renderEventDetailPage() {
    const nameEl = document.getElementById('event-name');
    if (!nameEl) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const events = getAllEvents();
    const event = events.find(ev => ev.id === id);
    if (!event) {
        const panel = document.getElementById('prodetails');
        panel.innerHTML = '<div><h1>Event unavailable</h1><p>This event could not be found.</p><a class="normal" href="events.html">View upcoming events</a></div>';
        return;
    }

    const imageEl = document.getElementById('event-main-image');
    const dateEl = document.getElementById('event-date');
    const timeEl = document.getElementById('event-time');
    const locationEl = document.getElementById('event-location');
    const descriptionEl = document.getElementById('event-description');

    document.title = `${event.name} | WholeHeartedHealth`;
    nameEl.textContent = event.name;
    if (imageEl) { imageEl.src = event.image; imageEl.alt = event.name; }
    if (dateEl) dateEl.textContent = event.date;
    if (timeEl) timeEl.textContent = event.time;
    if (locationEl) locationEl.textContent = event.location;
    if (descriptionEl) descriptionEl.textContent = event.description;
}

function getAuthHeaders() {
    const token = localStorage.getItem('w_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

function renderAdminLists() {
    const eventsList = document.getElementById('admin-events-list');
    const productsList = document.getElementById('admin-products-list');
    if (!eventsList || !productsList) return;

    const allEvents = getAllEvents();

    eventsList.innerHTML = allEvents.length
        ? allEvents.map((ev) => `<div class="admin-list-row"><span>${escapeHTML(ev.name)}</span><button class="white" type="button" data-edit-kind="events" data-edit-id="${escapeHTML(ev.id)}">Edit</button><button class="white" type="button" data-remove-event-id="${escapeHTML(ev.id)}">Remove</button></div>`).join('')
        : '<small style="color:var(--text-muted);">No events found.</small>';

    productsList.innerHTML = products.length
        ? products.map((p) => `<div class="admin-list-row"><span>${escapeHTML(p.name)} ($${formatMoney(p.price || 0)})</span><button class="white" type="button" data-edit-kind="products" data-edit-id="${escapeHTML(p.id)}">Edit</button><button class="white" type="button" data-remove-product-id="${escapeHTML(String(p.id))}">Remove</button></div>`).join('')
        : '<small style="color:var(--text-muted);">No products found.</small>';

    eventsList.querySelectorAll('[data-remove-event-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.removeEventId;
            if (!confirm('Are you sure you want to remove this event globally?')) return;
            try {
                const res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
                if (res.ok) {
                    showNotification('Event removed.');
                } else {
                    showNotification('Could not remove event from server.');
                }
            } catch (err) {
                showNotification('Network error removing event.');
            }
            await fetchGlobalEvents();
            renderAdminLists();
            renderEventsPage();
        });
    });

    productsList.querySelectorAll('[data-remove-product-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.removeProductId;
            if (!confirm('Are you sure you want to remove this product globally?')) return;
            try {
                const res = await fetch(`/api/products/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
                if (res.ok) {
                    showNotification('Product removed.');
                } else {
                    showNotification('Could not remove product from server.');
                }
            } catch (err) {
                showNotification('Network error removing product.');
            }
            await fetchGlobalProducts();
            renderAdminLists();
            renderCatalogCards();
        });
    });
}

function renderAdminPage() {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;

    if (!isSignedIn()) {
        const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `signin.html?redirect=${redirectUrl}`;
        return;
    }

    if (!isSuperiorAccount()) {
        panel.innerHTML = '<p style="color:#991b1b; font-weight:700;">This area is for administrators only.</p>';
        return;
    }

    const eventForm = document.getElementById('admin-event-form');
    const productForm = document.getElementById('admin-product-form');

    if (eventForm) {
        eventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = (document.getElementById('admin-event-name')?.value || '').trim();
            const imagePath = (document.getElementById('admin-event-image')?.value || '').trim();
            const imageFileInput = document.getElementById('admin-event-image-file');
            const imageFile = imageFileInput && imageFileInput.files ? imageFileInput.files[0] : null;
            const date = (document.getElementById('admin-event-date')?.value || '').trim();
            const time = (document.getElementById('admin-event-time')?.value || '').trim();
            const location = (document.getElementById('admin-event-location')?.value || '').trim();
            const description = (document.getElementById('admin-event-description')?.value || '').trim();

            if (!name || (!imageFile && !imagePath) || !date || !time || !location || !description) {
                showNotification('Please complete all event fields and provide an image.');
                return;
            }

            const formData = new FormData();
            formData.append('name', name);
            formData.append('date', date);
            formData.append('time', time);
            formData.append('location', location);
            formData.append('description', description);
            if (imageFile) {
                formData.append('imageFile', imageFile);
            } else {
                formData.append('image', imagePath);
            }

            try {
                const res = await fetch('/api/events', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: formData
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showNotification(data.error || 'Could not save event to server.');
                    return;
                }
                eventForm.reset();
                showNotification('Event added globally for all visitors!');
                await fetchGlobalEvents();
                renderAdminLists();
                renderEventsPage();
            } catch (err) {
                showNotification('Network error saving event.');
            }
        });
    }

    if (productForm) {
        productForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = (document.getElementById('admin-product-name')?.value || '').trim();
            const price = Number((document.getElementById('admin-product-price')?.value || '0').trim());
            const category = (document.getElementById('admin-product-category')?.value || '').trim();
            const description = (document.getElementById('admin-product-description')?.value || '').trim();
            const imageInputs = [
                document.getElementById('admin-product-image-file-1'),
                document.getElementById('admin-product-image-file-2'),
                document.getElementById('admin-product-image-file-3'),
                document.getElementById('admin-product-image-file-4')
            ];
            const imageFiles = imageInputs.map(input => (input && input.files ? input.files[0] : null));
            if (!imageFiles[0]) {
                showNotification('Please choose a product image.');
                return;
            }

            if (!name || !category || !description || !Number.isFinite(price) || price < 0) {
                showNotification('Please complete all product fields correctly.');
                return;
            }

            const formData = new FormData();
            formData.append('name', name);
            formData.append('price', String(price));
            formData.append('category', category);
            formData.append('description', description);
            imageFiles.forEach((file, index) => {
                if (file) formData.append(`image${index + 1}`, file);
            });

            try {
                const res = await fetch('/api/products', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: formData
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showNotification(data.error || 'Could not save product to server.');
                    return;
                }
                productForm.reset();
                showNotification('Product added globally for all visitors!');
                await fetchGlobalProducts();
                renderAdminLists();
                renderCatalogCards();
            } catch (err) {
                showNotification('Network error saving product.');
            }
        });
    }

    renderAdminLists();
}

const DEFAULT_NAVIGATION = [
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "home",
        "label": "Home",
        "url": "index.html",
        "icon": "fa-house"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "shop",
        "label": "Shop",
        "url": "shop.html",
        "icon": "fa-store"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "about",
        "label": "About",
        "url": "about.html",
        "icon": "fa-heart"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "contact",
        "label": "Contact",
        "url": "contact.html",
        "icon": "fa-envelope"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "events",
        "label": "Upcoming Events",
        "url": "events.html",
        "icon": "fa-calendar-days"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "wishlist",
        "label": "Wishlist",
        "url": "wishlist.html",
        "icon": "fa-clipboard-list"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "cart",
        "label": "Shopping bag",
        "url": "cart.html",
        "icon": "fa-bag-shopping"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "account",
        "label": "Your portal / Sign in",
        "url": "profile.html",
        "icon": "fa-circle-user"
    },
    {
        "visible": true,
        "audience": "admins",
        "presentation": "icon",
        "id": "admin",
        "label": "Admin panel",
        "url": "admin.html",
        "icon": "fa-shield-halved"
    },
    {
        "visible": false,
        "audience": "everyone",
        "presentation": "text",
        "id": "help",
        "label": "Help & ordering",
        "url": "help.html",
        "icon": "fa-circle-question"
    }
];
let navigationSettings = DEFAULT_NAVIGATION;
function menuItemVisible(item, signedIn = isSignedIn(), admin = isSuperiorAccount()) {
    if (!item.visible || (item.id === 'admin' && !admin)) return false;
    return item.audience === 'everyone' || (item.audience === 'guests' && !signedIn) ||
        (item.audience === 'members' && signedIn) || (item.audience === 'admins' && admin);
}
async function loadNavigationSettings() {
    try {
        const response = await fetch('/api/navigation', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data.navigation)) navigationSettings = data.navigation;
    } catch {}
}

let shopContentObserver;
function applyShopVisibility() {
    const shop = navigationSettings.find(item => item.id === 'shop');
    const available = !shop || menuItemVisible(shop);
    if (available) {
        document.querySelectorAll('[data-shop-hidden]').forEach(element => {
            element.hidden = false; delete element.dataset.shopHidden;
        });
    } else {
        const targets = new Set();
        document.querySelectorAll('a[href]').forEach(link => {
            try {
                const url = new URL(link.getAttribute('href'), location.href);
                if (url.origin !== location.origin) return;
                const destination = url.pathname.split('/').pop();
                const redirect = url.searchParams.get('redirect');
                if (['shop.html','sproduct.html'].includes(destination) || (destination === 'signin.html' && redirect && ['shop.html','sproduct.html'].includes(new URL(redirect, location.href).pathname.split('/').pop()))) {
                    targets.add(link.parentElement?.tagName === 'LI' ? link.parentElement : link);
                }
            } catch {}
        });
        const collection = document.getElementById('product1');
        if (collection && !collection.querySelector('#events-grid')) targets.add(collection);
        if (document.getElementById('product-name')) targets.add(document.getElementById('prodetails'));
        targets.forEach(element => {
            if (element && !element.hidden) { element.dataset.shopHidden = 'true'; element.hidden = true; }
        });
    }
    if (!shopContentObserver) {
        let queued = false;
        shopContentObserver = new MutationObserver(entries => {
            if (queued || !entries.some(entry => Array.from(entry.addedNodes).some(node => node instanceof Element && (node.matches('a[href]') || node.querySelector('a[href]'))))) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; applyShopVisibility(); });
        });
        shopContentObserver.observe(document.body, {childList:true,subtree:true});
    }
}

function updateAuthUI() {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    const signedIn = isSignedIn();
    const current = location.pathname.split('/').pop() || 'index.html';
    const aliases = { 'portal.html':'profile.html', 'sproduct.html':'shop.html', 'event-detail.html':'events.html' };
    const activePage = aliases[current] || current;
    nav.replaceChildren();
    navigationSettings.filter(item => menuItemVisible(item)).forEach(item => {
        const li = document.createElement('li');
        li.dataset.menuId = item.id;
        li.id = {cart:'lg-bag', wishlist:'nav-wishlist', account:'nav-user', admin:'nav-admin'}[item.id] || 'nav-' + item.id;
        const link = document.createElement('a');
        const label = item.id === 'account' ? (signedIn ? 'Your portal' : 'Sign in') : item.label;
        const destination = item.id === 'account' && !signedIn ? 'signin.html?redirect=profile.html' : item.url;
        link.href = destination;
        link.title = label;
        link.setAttribute('aria-label', label);
        if (activePage === destination.split('?')[0]) { link.classList.add('active'); link.setAttribute('aria-current','page'); }
        if (item.presentation === 'icon') {
            const icon = document.createElement('i');
            icon.className = 'fa-solid ' + item.icon;
            icon.setAttribute('aria-hidden','true');
            link.classList.add('menu-icon-link'); link.append(icon);
        } else link.textContent = label;
        li.append(link); nav.append(li);
    });
    updateCartCount();
    applyShopVisibility();
}

function getWishlist() {
    try { const value = JSON.parse(localStorage.getItem('w_wishlist') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
function saveWishlist(list) {
    localStorage.setItem('w_wishlist', JSON.stringify(list));
}
function toggleWishlist(productId) {
    const list = getWishlist();
    const exists = list.includes(productId);
    if (exists) {
        const updated = list.filter(id => id !== productId);
        saveWishlist(updated);
        showNotification('Removed from wishlist');
    } else {
        list.push(productId);
        saveWishlist(list);
        showNotification('Added to wishlist');
    }
    updateWishlistButtons();
    renderWishlistPage();
    // update header badges immediately (cart + wishlist)
    updateCartCount();
}
function updateWishlistButtons() {
    document.querySelectorAll('.btn-wishlist').forEach(btn => {
        const productId = parseInt(btn.dataset.productId);
        const active = getWishlist().includes(productId);
        btn.classList.toggle('active', active);
        btn.title = active ? 'Remove from wishlist' : 'Add to wishlist';
        btn.innerHTML = active ? '−' : '+';
        if (active) {
            btn.style.color = 'var(--gold)';
            btn.style.transform = 'scale(1.25)';
        } else {
            btn.style.color = 'var(--text-muted)';
            btn.style.transform = 'scale(1)';
        }
    });
}
function renderWishlistPage() {
    // Only run on the wishlist page
    if (!isWishlistPage()) return;
    const container = document.querySelector('.pro-container');
    if (!container) return;
    // Require sign-in to view wishlist
    if (!isSignedIn()) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px 0; color:var(--text-muted); grid-column: 1 / -1;">
                <p>Sign in to view your wishlist</p>
                <a href="signin.html?redirect=wishlist.html" class="normal" style="display:inline-block; margin-top:12px; padding:10px 24px; background:var(--action); color:#fffaf7; border-radius:12px;">Sign In</a>
            </div>
        `;
        return;
    }
    const ids = getWishlist().filter(id => products.some(product => product.id === id));
    if (ids.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:40px 0; color:var(--text-muted); grid-column: 1 / -1;">Your wishlist is empty.</p>`;
        return;
    }
    const html = ids.map(id => {
        const p = products.find(x => x.id === id);
        if (!p) return '';
        return `
            <div class="pro" data-product-id="${escapeHTML(p.id)}" style="position:relative;">
                <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}">
                <div class="des">
                    <span>${escapeHTML(p.category || "Product")}</span>
                    <h5><a href="sproduct.html?id=${encodeURIComponent(p.id)}">${escapeHTML(p.name)}</a></h5>
                    <h4>$${formatMoney(p.price)}</h4>
                </div>
                <button class="btn-wishlist active" data-product-id="${escapeHTML(p.id)}" title="Remove from wishlist">−</button>
                <div class="wishlist-card-actions">
                    <a class="wishlist-cart-btn" href="#" data-product-id="${escapeHTML(p.id)}"><i class="fa-solid fa-cart-shopping"></i> Add to Cart</a>
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = html;
    
    // Attach remove handlers (allow clicking the top-right "−" on wishlist cards)
    document.querySelectorAll('.pro .btn-wishlist').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const productId = parseInt(e.currentTarget.dataset.productId);

            // Ensure we remove the item (always remove, don't toggle)
            const list = getWishlist();
            if (!list.includes(productId)) return; // Item not in wishlist, nothing to remove

            // Animate out
            const card = e.currentTarget.closest('.pro');
            if (card) {
                card.style.transition = 'transform 0.3s, opacity 0.3s';
                card.style.transform = 'scale(0.9)';
                card.style.opacity = '0';
            }

            setTimeout(() => {
                // Remove directly (don't toggle)
                const updated = list.filter(id => id !== productId);
                saveWishlist(updated);
                showNotification('Removed from wishlist');
                updateWishlistButtons();
                renderWishlistPage();
                updateCartCount();
            }, 300);
        });
    });
    // Attach add-to-cart handlers on wishlist page
    document.querySelectorAll('.wishlist-cart-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const productId = parseInt(e.currentTarget.dataset.productId);
            const prod = products.find(p => p.id === productId);
            if (prod) {
                cart.addItem(prod);
                showNotification(`${prod.name} added to cart!`);
                updateCartCount();
            }
        });
    });
    // NOTE: We do NOT call setupAddToCartButtons() here anymore,
    // because that would inject "+" wishlist buttons onto the cards.
}

function renderProfilePage() {
    const panel = document.getElementById('profile-settings');
    if (!panel) return;

    if (new URLSearchParams(location.search).has('newsletter_verify') || new URLSearchParams(location.search).has('unsubscribe')) { document.querySelector('[data-newsletter-action]')?.closest('section')?.remove(); return; }
    if (!isSignedIn()) {
        const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `signin.html?redirect=${redirectUrl}`;
        return;
    }

    const user = getCurrentUser();
    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    const signoutBtn = document.getElementById('profile-signout');
    const form = document.getElementById('profile-form');

    if (nameInput) nameInput.value = user?.name || '';
    if (emailInput) emailInput.value = user?.email || '';

    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const nextName = (nameInput?.value || '').trim();
            const nextEmail = (emailInput?.value || '').trim();
            if (!nextName || !nextEmail) {
                showNotification('Please fill in your name and email.');
                return;
            }

            try {
                const response = await fetch('/api/auth/profile', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: nextName, email: nextEmail })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not save profile.');
                localStorage.setItem('w_user', JSON.stringify(result.user));
                updateAuthUI();
                showNotification('Profile saved.');
            } catch (err) {
                showNotification(err.message || 'Could not save profile.');
            }
        });
    }

    if (signoutBtn) {
        signoutBtn.addEventListener('click', async () => {
            try { await signOutUser(); window.location.href = 'signin.html'; }
            catch(error) { showNotification(error.message); }
        });
    }
}
// Setup checkout button (requires sign-in)
async function setupCheckoutButton() {
    const checkoutBtn = document.querySelector('#subtotal button.normal');
    
    if (checkoutBtn) {
        const notice = document.getElementById('checkout-availability');
        checkoutBtn.disabled = true;
        try {
            const response = await fetch('/api/checkout/availability', { cache: 'no-store' });
            if (!response.ok) throw new Error('Availability check failed');
            const availability = await response.json();
            checkoutBtn.disabled = !availability.enabled;
            checkoutBtn.textContent = availability.enabled ? 'Continue to checkout' : 'Checkout temporarily paused';
            if (notice) notice.textContent = availability.message;
        } catch {
            checkoutBtn.textContent = 'Checkout unavailable';
            if (notice) notice.textContent = 'We could not check checkout availability. Please refresh to try again.';
        }
        checkoutBtn.addEventListener('click', async () => {
            if (cart.items.length === 0) {
                showNotification('Your cart is empty');
                return;
            }
            if (!isSignedIn()) {
                const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `signin.html?redirect=${redirectUrl}`;
                return;
            }
            
            checkoutBtn.disabled = true;
            try {
                const response = await fetch('/api/checkout/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: cart.items.map(item => ({ id: item.id, quantity: item.quantity, size: item.size || '' })) })
                });
                const result = await response.json();
                if (!response.ok || !result.url) throw new Error(result.error || 'Checkout is unavailable.');
                window.location.assign(result.url);
            } catch (err) {
                showNotification(err.message || 'Checkout is unavailable.');
                checkoutBtn.disabled = false;
            }
        });
    }
}

function setupNewsletterForms() {
    document.querySelectorAll('#newsletter .form, .footer-newsletter .form').forEach(container => {
        const input = container.querySelector('input[type="email"], input[type="text"]');
        const button = container.querySelector('button');
        if (!input || !button || button.dataset.newsletterReady) return;
        button.dataset.newsletterReady = '1';
        button.addEventListener('click', async event => {
            event.preventDefault();
            const email = input.value.trim();
            if (!email) return showNotification('Enter your email address.');
            try {
                const response = await fetch('/api/newsletter/subscribe', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
                });
                const result = await response.json();
                showNotification(result.message || result.error || 'Could not subscribe.');
                if (response.ok) input.value = '';
            } catch (err) { showNotification('Newsletter signup is unavailable.'); }
        });
    });
}

async function handleNewsletterLink() {
    const params = new URLSearchParams(window.location.search);
    const verification = params.get('newsletter_verify');
    const unsubscribe = params.get('unsubscribe');
    if (!verification && !unsubscribe) return;
    const endpoint = verification ? '/api/newsletter/verify' : '/api/newsletter/unsubscribe';
    const body = verification ? { token: verification } : { token: unsubscribe };
    try {
        const response = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        const result = await response.json();
        const panel = document.getElementById('profile-settings');
        if (panel) panel.innerHTML = `<div class="profile-card"><h2>Newsletter preferences</h2><p role="status">${escapeHTML(result.message || result.error)}</p><a href="index.html">Return home</a></div>`;
        showNotification(result.message || result.error);
    } catch (err) {
        const panel = document.getElementById('profile-settings');
        if (panel) panel.innerHTML = '<p role="alert">The request could not be completed. Please reload to try again.</p>';
    }
}
async function showCheckoutStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'cancel') {
        showNotification('Checkout was canceled. Your cart is still here.');
        return;
    }
    const sessionId = params.get('session_id');
    if (params.get('checkout') !== 'success' || !sessionId) return;
    try {
        const response = await fetch(`/api/checkout/status/${encodeURIComponent(sessionId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not verify payment.');
        if (result.status === 'paid') {
            cart.clear();
            displayCartItems();
            updateCartCount();
            showNotification('Payment confirmed. Thank you for your order.');
        } else {
            showNotification('Payment is still being verified. Your cart has been kept.');
        }
    } catch (err) {
        showNotification(err.message || 'Payment status is unavailable.');
    }
}
// Setup single product page
function setupSingleProduct() {
    const addToCartBtn = document.querySelector('#add-single-product') || document.querySelector('#prodetails .single-pro-details button.normal');
    const quantityInput = document.querySelector('#product-quantity') || document.querySelector('#prodetails .single-pro-details input[type="number"]');
    const sizeInput = document.querySelector('#product-size');
    
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => {
            const quantity = Number(quantityInput ? quantityInput.value : 1);
            const product = window.currentProduct;
            if (!product) {
                showNotification('Product is still loading or unavailable.');
                return;
            }
            
            const size = sizeInput ? sizeInput.value : '';
            if (sizeInput && (!size || size === 'Select Size')) {
                showNotification('Choose a size before adding this product.');
                return;
            }
            if (!cart.addItem(product, quantity, { size })) {
                showNotification('Choose a whole quantity from 1 to 999.');
                return;
            }
            showNotification(`${product.name} added to cart!`);
            updateCartCount();
        });
    }
}
window.addEventListener('storage', event => {
    if (event.key === 'w_wishlist') { renderWishlistPage(); updateWishlistButtons(); updateCartCount(); }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    const menuReady = loadNavigationSettings();
    try {
        const authResponse = await fetch('/api/auth/me');
        const authData = await authResponse.json();
        if (authData.user) localStorage.setItem('w_user', JSON.stringify(authData.user));
        else localStorage.removeItem('w_user');
    } catch (err) {
        localStorage.removeItem('w_user');
    }
    try {
        await Promise.allSettled([
            document.querySelector('#product1 .pro-container:not(#events-grid), #cart, #wishlist, #product-name, #admin-panel') ? fetchGlobalProducts() : Promise.resolve(),
            document.querySelector('#events-grid, #event-name, #admin-panel') ? fetchGlobalEvents() : Promise.resolve()
        ]);
    } catch (err) {}
    renderCatalogCards();
    renderEventsPage();
    renderEventDetailPage();
    renderAdminPage();

    initScrollReveal();
    initHomepageParallax();
    setupAddToCartButtons();
    displayCartItems();
    updateCartCount();
    setupSingleProduct();
    setupCheckoutButton();
    setupNewsletterForms();
    await handleNewsletterLink();
    showCheckoutStatus();
    // Auth + wishlist UI
    await menuReady;
    updateAuthUI();
    
    // Only update "+" wishlist buttons on non-wishlist pages
    if (!isWishlistPage()) {
        updateWishlistButtons();
    }
    
    // Render the wishlist page if we're on it
    renderWishlistPage();
    renderProfilePage();
    await renderCustomerPortal();
    
});

let scrollRevealObserver;
function initScrollReveal() {
    const selectors = [
        'section:not(#header):not(#hero) > *',
        '.pro-container .pro',
        '.admin-card, .admin-editor-card, .admin-row, .portal-card, .profile-card, #support-request-form, .auth-card, footer .col',
        '#hero .hero-logo-layer'
    ];

    const targets = Array.from(new Set(
        Array.from(document.querySelectorAll(selectors.join(',')))
    )).filter(el => (
        el instanceof HTMLElement
        && !el.closest('#header')
        && !el.matches('[aria-hidden="true"]')
        && !el.matches('[aria-hidden="true"]')
        && !el.classList.contains('hero-parallax')
        && (!el.matches('section') || el.matches('.admin-card, .portal-card'))
        && !el.matches('.pro-container, .pro-container-wrap')
    ));

    if (!targets.length) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const groupedTargets = new Map();
    targets.forEach(el => {
        const groupRoot = el.closest('.pro-container, #form-details, footer, section') || el.parentElement || document.body;
        if (!groupedTargets.has(groupRoot)) groupedTargets.set(groupRoot, []);
        groupedTargets.get(groupRoot).push(el);
    });

    groupedTargets.forEach(group => {
        group.forEach((el, idx) => {
            const delay = Math.min(idx * 85, 600);
            el.style.setProperty('--reveal-delay', `${delay}ms`);
            el.classList.add('reveal-on-scroll');
        });
    });

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
        targets.forEach(el => el.classList.add('is-visible'));
        return;
    }

    const observeTargets = () => {
    scrollRevealObserver?.disconnect();
    scrollRevealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
            } else if ((entry.boundingClientRect.bottom <= 0 || entry.boundingClientRect.top >= innerHeight) && !entry.target.contains(document.activeElement)) {
                entry.target.classList.remove('is-visible');
            }
        });
    }, {
        threshold: 0.04,
        rootMargin: '0px 0px -10% 0px'
    });

    targets.forEach(el => scrollRevealObserver.observe(el));
    };
    if (document.getElementById('page-loader')) {
        document.addEventListener('page-intro-ready', observeTargets, { once: true });
    } else observeTargets();
}

function initHomepageParallax() {
    const items = document.querySelectorAll('[data-parallax-speed]');
    if (!items.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const parsed = Array.from(items).map(el => ({
        el,
        speed: parseFloat(el.dataset.parallaxSpeed || '0'),
        limit: parseFloat(el.dataset.parallaxLimit || '80')
    }));

    let ticking = false;
    let pointerX = 0;
    let pointerY = 0;

    const update = () => {
        const y = window.scrollY || window.pageYOffset || 0;
        parsed.forEach(item => {
            const moveY = Math.max(-item.limit, Math.min(item.limit, y * (item.speed * 2.8)));
            const driftX = Math.max(-38, Math.min(38, pointerX * item.speed * 72));
            const driftY = Math.max(-28, Math.min(28, pointerY * item.speed * 56));
            item.el.style.transform = `translate3d(${driftX.toFixed(2)}px, ${(moveY + driftY).toFixed(2)}px, 0)`;
        });
        ticking = false;
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    };

    const onPointerMove = (event) => {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        pointerX = ((event.clientX / w) - 0.5) * 2;
        pointerY = ((event.clientY / h) - 0.5) * 2;
        onScroll();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    update();
}

// Reinitialize when page becomes visible
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        cart.items = cart.loadCart();
        displayCartItems();
        updateCartCount();
    }
});






document.addEventListener('click', async event => {
    const button = event.target.closest('[data-edit-kind]');
    if (!button) return;
    const kind = button.dataset.editKind;
    const item = (kind === 'products' ? products : getAllEvents()).find(item => String(item.id) === button.dataset.editId);
    if (!item) return;
    const dialog = document.createElement('dialog');
    const fields = kind === 'products' ? ['name', 'price', 'category', 'description'] : ['name', 'date', 'time', 'location', 'description'];
    dialog.innerHTML = `<form class="edit-item-form"><h2>Edit ${kind === 'products' ? 'product' : 'event'}</h2>${fields.map(field => `<label>${escapeHTML(field)}<input name="${field}" value="${escapeHTML(item[field])}" required></label>`).join('')}<p role="status"></p><button class="normal">Save changes</button><button type="button" data-close>Cancel</button></form>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        try {
            const response = await fetch(`/api/${kind}/${encodeURIComponent(item.id)}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            await Promise.all([fetchGlobalProducts(), fetchGlobalEvents()]);
            renderAdminLists(); dialog.close(); showNotification('Changes saved.');
        } catch(error) { dialog.querySelector('[role=status]').textContent = error.message; }
    };
    dialog.showModal();
});

document.querySelectorAll('[data-newsletter-action]').forEach(button => button.addEventListener('click', async () => {
    const output = document.getElementById('newsletter-status');
    button.disabled = true;
    try {
        const user = getCurrentUser();
        const response = await fetch(`/api/newsletter/${button.dataset.newsletterAction}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:user?.email}) });
        const result = await response.json();
        output.textContent = result.message || result.error;
    } catch { output.textContent = 'Could not update your preference. Please try again.'; }
    finally { button.disabled = false; }
}));

async function renderCustomerPortal() {
    const loading = document.getElementById('portal-loading');
    if (!loading) return;
    const params = new URLSearchParams(location.search);
    if (params.has('newsletter_verify') || params.has('unsubscribe')) {
        loading.closest('.portal-page').hidden = true;
        document.querySelector('#page-header h1').textContent = 'Newsletter preferences';
        document.querySelector('#page-header p').textContent = 'Your subscription, your choice.';
        return;
    }
    if (!isSignedIn()) return;
    try {
        const response = await fetch('/api/portal');
        if (response.status === 401) { location.href = 'signin.html?redirect=profile.html'; return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your portal.');
        document.getElementById('portal-welcome').textContent = 'Welcome back, ' + data.user.name;
        document.getElementById('portal-orders').innerHTML = data.orders.length ? data.orders.map(order => {
            const progress = Math.max(0, Math.min(100, Number(order.progress) || 0));
            return `<article class="portal-card"><div class="portal-card-top"><strong>Order ${escapeHTML(String(order.id).slice(-8))}</strong><span class="status-pill">${escapeHTML(order.status)}</span></div><p>${order.items.map(item => escapeHTML(item.quantity + ' × ' + item.name + (item.size ? ' (' + item.size + ')' : ''))).join(', ')}</p><div class="progress-track" role="progressbar" aria-label="Order progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><small>${progress}% complete</small>${order.note ? '<p class="portal-note">' + escapeHTML(order.note) + '</p>' : ''}</article>`;
        }).join('') : '<div class="portal-card empty-state"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i><h3>A little room for something good</h3><p>Your orders will appear here when you place one.</p><a href="shop.html">Browse the shop</a></div>';
        document.getElementById('portal-requests').innerHTML = data.requests.length ? data.requests.map(item => `<article class="portal-card"><div class="portal-card-top"><strong>${escapeHTML(item.subject)}</strong><span class="status-pill">${escapeHTML(item.status)}</span></div><p>${escapeHTML(item.message)}</p>${item.note ? '<p class="portal-note">' + escapeHTML(item.note) + '</p>' : ''}</article>`).join('') : '<div class="portal-card empty-state"><i class="fa-regular fa-comment" aria-hidden="true"></i><h3>We’re here when you need us</h3><p>Your support conversations will appear here.</p></div>';
        loading.hidden = true;
        document.getElementById('portal-content').hidden = false;
        initScrollReveal();
    } catch (error) {
        loading.textContent = error.message;
        const retry = document.createElement('button');
        retry.className = 'white'; retry.textContent = 'Try again';
        retry.onclick = () => { loading.textContent = 'Loading your portal…'; renderCustomerPortal(); };
        loading.append(document.createElement('br'), retry);
    }
}

// A short brand introduction on every navigation and reload, independent of API latency.
(function initPageIntro() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { loader.remove(); return; }
    setTimeout(() => {
        loader.classList.add('is-leaving');
        setTimeout(() => {
            loader.remove();
            document.dispatchEvent(new Event('page-intro-ready'));
        }, 450);
    }, 650);
})();
