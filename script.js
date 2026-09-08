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
}

if (menuButton && bar && nav) {
    menuButton.addEventListener('click', () => {
        setMenuState(!nav.classList.contains('active'));
    });

    nav.querySelectorAll('a[href]').forEach(link => {
        link.addEventListener('click', () => setMenuState(false));
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && nav.classList.contains('active')) {
            setMenuState(false);
        }
    });
}

// Global image fallback: try the new logo file first, then existing logo.png
const LOGO_PRIMARY = 'img/309882121_5132988574724647418299_n.jpg';
const LOGO_FALLBACK = 'img/logo.png';

document.addEventListener('DOMContentLoaded', () => {
    // targeted logo/page-logo fallback
    document.querySelectorAll('img.logo, .page-logo').forEach(img => {
        img.addEventListener('error', () => {
            if (!img.dataset.triedPrimary) { img.dataset.triedPrimary = '1'; img.src = LOGO_PRIMARY; return; }
            if (!img.dataset.triedFallback) { img.dataset.triedFallback = '1'; img.src = LOGO_FALLBACK; }
        });
    });

    // global fallback for any image â€” replace broken images with the primary logo (prevents broken layout)
    document.querySelectorAll('img').forEach(img => {
        img.addEventListener('error', () => {
            if (!img.dataset.replaced) { img.dataset.replaced = '1'; img.src = LOGO_PRIMARY; }
        });
    });

    // Hero button image fallback: if the themed button image fails to load, remove it and show a styled text CTA
    const heroBtnImg = document.querySelector('#hero a.normal img');
    if (heroBtnImg) {
        heroBtnImg.addEventListener('error', () => {
            const a = heroBtnImg.closest('a');
            if (a) {
                try { heroBtnImg.remove(); } catch (e) {}
                a.classList.add('hero-fallback');
                a.textContent = 'Shop Now';
            }
        });
    }
});

// ONE-TIME: clear localStorage & sessionStorage on next load (safe â€” it sets a flag so this runs only once)
if (!localStorage.getItem('__cleared_once__')) {
    try {
        localStorage.clear();
        sessionStorage.clear();
        // set a marker so the clear happens only once
        localStorage.setItem('__cleared_once__', '1');
        console.info('Cleared localStorage and sessionStorage (one-time).');
    } catch (err) {
        console.warn('Unable to clear storage:', err);
    }
}
// Product Database
const products = [
    { id: 1, name: "Cartoon Astronaut Tshirt", price: 118.19, image: "img/products/f1.jpg", category: "tshirt" },
    { id: 2, name: "Casual Wear", price: 95.00, image: "img/products/f1.jpg", category: "casual" },
    { id: 3, name: "Summer Collection", price: 125.50, image: "img/products/f1.jpg", category: "summer" },
    { id: 4, name: "Classic Design", price: 89.99, image: "img/products/f1.jpg", category: "classic" },
    { id: 5, name: "Modern Fashion", price: 145.00, image: "img/products/f1.jpg", category: "modern" },
    { id: 6, name: "Premium Wear", price: 199.99, image: "img/products/f1.jpg", category: "premium" },
    { id: 7, name: "Elegant Style", price: 110.00, image: "img/products/f1.jpg", category: "elegant" },
    { id: 8, name: "Comfort Plus", price: 99.99, image: "img/products/f1.jpg", category: "comfort" }
];

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
        return saved ? JSON.parse(saved) : [];
    }
    saveCart() {
        localStorage.setItem('cart', JSON.stringify(this.items));
    }
    addItem(product, quantity = 1) {
        const existingItem = this.items.find(item => item.id === product.id);
        
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.items.push({
                ...product,
                quantity: quantity
            });
        }
        this.saveCart();
    }
    removeItem(productId) {
        this.items = this.items.filter(item => item.id !== productId);
        this.saveCart();
    }
    updateQuantity(productId, quantity) {
        const item = this.items.find(item => item.id === productId);
        if (item) {
            item.quantity = Math.max(1, quantity);
            this.saveCart();
        }
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
// Coupons system
const coupons = {
    'SAVE10': 0.10,
    'SAVE20': 0.20,
    'WELCOME5': 0.05,
    'FREESHIP': 0.15,
    'SUMMER2026': 0.25
};
let appliedCoupon = null;
let discountAmount = 0;
let usedCoupons = loadUsedCoupons();
function loadUsedCoupons() {
    const saved = localStorage.getItem('usedCoupons');
    return saved ? JSON.parse(saved) : [];
}
function saveUsedCoupons() {
    localStorage.setItem('usedCoupons', JSON.stringify(usedCoupons));
}
function addUsedCoupon(code) {
    if (!usedCoupons.includes(code)) {
        usedCoupons.push(code);
        saveUsedCoupons();
    }
}
// ---------- Helper: detect if we are on the wishlist page ----------
function isWishlistPage() {
    return window.location.pathname.endsWith('wishlist.html') ||
           document.querySelector('#wishlist') !== null;
}
// Add to Cart functionality
function setupAddToCartButtons() {
    const addToCartButtons = document.querySelectorAll('.btn-add-cart, .cart, a .fa-cart-shopping');
    
    addToCartButtons.forEach(button => {
        button.closest('a, button') ? button.closest('a, button').addEventListener('click', handleAddToCart) : null;
    });
    // Setup for product containers
    const products_elements = document.querySelectorAll('.pro:not([data-skip-product-behavior])');
    products_elements.forEach((product, index) => {
        // Make the product box clickable to go to sproduct
        product.style.cursor = 'pointer';
        product.querySelector('img').style.cursor = 'pointer';
        
        product.addEventListener('click', (e) => {
            if (e.target.classList.contains('cart') || e.target.closest('a') || 
                e.target.classList.contains('btn-wishlist') || e.target.classList.contains('wishlist-remove-btn')) {
                return;
            }
            const dataId = parseInt(product.dataset.productId || '', 10);
            const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : ((index % products.length) + 1);
            window.location.href = `sproduct.html?id=${productId}`;
        });
        
        // Handle cart button separately
        const cartBtn = product.querySelector('.cart') || product.querySelector('[data-cart-btn]');
        if (cartBtn) {
            cartBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dataId = parseInt(product.dataset.productId || '', 10);
                const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : (index + 1);
                const prod = products.find(p => p.id === productId) || products.find(p => p.id === ((productId - 1) % products.length + 1));
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
                wishBtn.style.cssText = 'position:absolute; top:10px; right:48px; border:none; background:transparent; font-size:20px; cursor:pointer; color:#777; font-weight:700;';
                
                const dataId = parseInt(product.dataset.productId || '', 10);
                const productId = Number.isFinite(dataId) && dataId > 0 ? dataId : (index + 1);
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
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #c79a4a;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        animation: slideIn 0.3s ease-in;
    `;
    
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
            <td><a href="#" onclick="removeFromCart(${item.id}); return false;"><i class="far fa-times-circle"></i></a></td>
            <td><img src="${item.image}" alt="${item.name}" style="width: 50px;"></td>
            <td>${item.name}</td>
            <td>$${formatMoney(item.price)}</td>
            <td><input type="number" value="${item.quantity}" onchange="updateCartQuantity(${item.id}, this.value)" min="1"></td>
            <td>$${formatMoney(subtotal)}</td>
        `;
        
        cartTable.appendChild(row);
    });
    updateCartTotals();
}
function removeFromCart(productId) {
    cart.removeItem(productId);
    displayCartItems();
    updateCartCount();
}
function updateCartQuantity(productId, quantity) {
    const qty = Math.max(1, parseInt(quantity) || 1);
    cart.updateQuantity(productId, qty);
    displayCartItems();
    updateCartCount();
}
function updateCartTotals() {
    const subtotal = cart.getTotal();
    discountAmount = subtotal * (appliedCoupon ? coupons[appliedCoupon] : 0);
    const total = subtotal - discountAmount;
    
    const cartTotals = document.querySelector('#subtotal');
    if (cartTotals) {
        const subtotalCell = cartTotals.querySelector('table tr:first-child td:last-child');
        const totalCell = cartTotals.querySelector('table tr:last-child td:last-child');
        const savedRow = document.querySelector('#saved-row');
        const savedCell = savedRow ? savedRow.querySelector('td:last-child strong') : null;
        
        if (subtotalCell) subtotalCell.textContent = `$ ${formatMoney(subtotal)}`;
        if (totalCell) totalCell.textContent = `$ ${formatMoney(total)}`;
        
        if (discountAmount > 0) {
            if (savedRow) savedRow.style.display = 'table-row';
            if (savedCell) savedCell.textContent = `-$ ${formatMoney(discountAmount)}`;
        } else {
            if (savedRow) savedRow.style.display = 'none';
        }
    }
}
// Apply coupon functionality
function setupCouponSystem() {
    const couponInput = document.querySelector('#coupon input[type="text"]');
    const couponBtn = document.querySelector('#coupon button');
    
    if (couponBtn) {
        couponBtn.addEventListener('click', () => {
            const code = couponInput.value.trim().toUpperCase();
            
            if (usedCoupons.includes(code)) {
                showNotification('This coupon has already been used');
            } else if (coupons[code]) {
                appliedCoupon = code;
                const discount = (coupons[code] * 100).toFixed(0);
                showNotification(`Coupon applied! ${discount}% off`);
                updateCartTotals();
                couponInput.value = '';
            } else {
                showNotification('Invalid coupon code');
            }
        });
    }
}
// --- Auth (mock) and wishlist helpers ---
function isSignedIn() {
    return !!localStorage.getItem('w_user');
}
function getCurrentUser() {
    const u = localStorage.getItem('w_user');
    return u ? JSON.parse(u) : null;
}
function signInUser(email, name) {
    const user = { email, name: name || email.split('@')[0], role: 'user' };
    localStorage.setItem('w_user', JSON.stringify(user));
    updateAuthUI();
}
function signOutUser() {
    try {
        fetch('/api/auth/signout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('w_user');
    localStorage.removeItem('w_token');
    localStorage.removeItem('w_wishlist');
    updateAuthUI();
}

function isSuperiorAccount() {
    const user = getCurrentUser();
    return !!(user && user.role === 'superior');
}

async function fetchGlobalProducts() {
    try {
        const res = await fetch('/api/products');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.products) && data.products.length > 0) {
                products.length = 0;
                data.products.forEach(p => products.push(p));
                return data.products;
            }
        }
    } catch (err) {}
    return products;
}

async function fetchGlobalEvents() {
    try {
        const res = await fetch('/api/events');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.events) && data.events.length > 0) {
                window.globalEvents = data.events;
                return data.events;
            }
        }
    } catch (err) {}
    return getDefaultEvents();
}

function getCustomProducts() {
    try {
        const raw = localStorage.getItem('w_custom_products');
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (err) {
        return [];
    }
}

function saveCustomProducts(list) {
    localStorage.setItem('w_custom_products', JSON.stringify(list));
}

function syncProductsFromStorage() {
    const custom = getCustomProducts();
    custom.forEach(p => {
        if (!products.some(existing => existing.id === p.id)) {
            products.push(p);
        }
    });
}

function getDefaultEvents() {
    return [
        {
            id: 'spring-wellness-workshop',
            name: 'Spring Wellness Workshop',
            image: 'img/products/f1.jpg',
            date: 'March 21, 2026',
            time: '10:00 AM - 12:00 PM',
            location: 'WholeHeartedHealth Community Room',
            description: 'This workshop covers simple routines for energy, stress balance, and daily nutrition planning. You will get a guided wellness session, a Q&A block, and a take-home checklist for a 30-day reset.'
        },
        {
            id: 'nutrition-qa-night',
            name: 'Nutrition Q&A Night',
            image: 'img/products/f2.jpg',
            date: 'April 11, 2026',
            time: '6:30 PM - 8:00 PM',
            location: 'Online Live Session',
            description: 'Bring your nutrition questions and get practical answers in a live group session. Topics include meal timing, label reading, hydration habits, and healthy grocery planning.'
        },
        {
            id: 'summer-product-preview',
            name: 'Summer Product Preview',
            image: 'img/products/f3.jpg',
            date: 'May 9, 2026',
            time: '1:00 PM - 3:00 PM',
            location: 'Main Storefront',
            description: 'See upcoming seasonal products before launch and get first access signup at the event. Meet the team, test samples, and hear how each product fits into your routine.'
        }
    ];
}

function getCustomEvents() {
    try {
        const raw = localStorage.getItem('w_custom_events');
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (err) {
        return [];
    }
}

function saveCustomEvents(list) {
    localStorage.setItem('w_custom_events', JSON.stringify(list));
}

function getAllEvents() {
    if (window.globalEvents && window.globalEvents.length > 0) {
        return window.globalEvents;
    }
    const defaults = getDefaultEvents();
    const custom = getCustomEvents();
    return defaults.concat(custom.filter(ev => !defaults.some(d => d.id === ev.id)));
}

function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read file.'));
        reader.readAsDataURL(file);
    });
}

function renderEventsPage() {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    const events = getAllEvents();
    grid.innerHTML = events.map(ev => `
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
    `).join('');
}

function renderEventDetailPage() {
    const nameEl = document.getElementById('event-name');
    if (!nameEl) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const events = getAllEvents();
    const event = events.find(ev => ev.id === id) || events[0];
    if (!event) return;

    const imageEl = document.getElementById('event-main-image');
    const dateEl = document.getElementById('event-date');
    const timeEl = document.getElementById('event-time');
    const locationEl = document.getElementById('event-location');
    const descriptionEl = document.getElementById('event-description');

    document.title = `${event.name} | WholeHeartedHealth`;
    nameEl.textContent = event.name;
    if (imageEl) imageEl.src = event.image;
    if (dateEl) dateEl.textContent = event.date;
    if (timeEl) timeEl.textContent = event.time;
    if (locationEl) locationEl.textContent = event.location;
    if (descriptionEl) descriptionEl.textContent = event.description;
}

function renderCustomProductsOnShop() {
    const shopContainer = document.querySelector('#product1 .pro-container');
    if (!shopContainer) return;

    shopContainer.querySelectorAll('.pro.custom-product-card').forEach(card => card.remove());
    const custom = products.filter(p => (typeof p.id === 'number' && p.id > 8) || typeof p.id === 'string');

    custom.forEach(p => {
        const card = document.createElement('div');
        card.className = 'pro custom-product-card';
        card.dataset.productId = String(p.id);
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" style="cursor:pointer;">
            <div class="des">
                <span>${escapeHTML(p.category || 'custom')}</span>
                <h5>${escapeHTML(p.name)}</h5>
                <div class="star">
                    <i class="fas fa-star"></i>
                    <i class="fas fa-star"></i>
                    <i class="fas fa-star"></i>
                    <i class="fas fa-star"></i>
                    <i class="fas fa-star"></i>
                </div>
                <h4>$${formatMoney(p.price || 0)}</h4>
            </div>
            <a href="#"><i class="fa-solid fa-cart-shopping cart"></i></a>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('cart') || e.target.closest('a') || 
                e.target.classList.contains('btn-wishlist') || e.target.classList.contains('wishlist-remove-btn')) {
                return;
            }
            window.location.href = `sproduct.html?id=${encodeURIComponent(p.id)}`;
        });

        const cartBtn = card.querySelector('.cart');
        if (cartBtn) {
            cartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                cart.addItem(p);
                showNotification(`${p.name} added to cart!`);
                updateCartCount();
            });
        }

        if (!isWishlistPage()) {
            const wishBtn = document.createElement('button');
            wishBtn.className = 'btn-wishlist';
            wishBtn.type = 'button';
            wishBtn.title = 'Add to wishlist';
            wishBtn.innerHTML = '+';
            wishBtn.style.cssText = 'position:absolute; top:10px; right:48px; border:none; background:transparent; font-size:20px; cursor:pointer; color:#777; font-weight:700;';
            wishBtn.dataset.productId = String(p.id);
            wishBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!isSignedIn()) {
                    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
                    window.location.href = `signin.html?redirect=${redirectUrl}`;
                    return;
                }
                toggleWishlist(p);
            });
            card.appendChild(wishBtn);
        }

        shopContainer.appendChild(card);
    });
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
        ? allEvents.map((ev) => `<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #eee; padding:8px 0;"><span>${escapeHTML(ev.name)}</span><button class="white" type="button" data-remove-event-id="${escapeHTML(ev.id)}">Remove</button></div>`).join('')
        : '<small style="color:#777;">No events found.</small>';

    productsList.innerHTML = products.length
        ? products.map((p) => `<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #eee; padding:8px 0;"><span>${escapeHTML(p.name)} ($${formatMoney(p.price || 0)})</span><button class="white" type="button" data-remove-product-id="${escapeHTML(String(p.id))}">Remove</button></div>`).join('')
        : '<small style="color:#777;">No products found.</small>';

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
            renderCustomProductsOnShop();
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
        panel.innerHTML = '<p style="color:#991b1b; font-weight:700;">This area is for superior accounts only.</p>';
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
            const hasAllImages = imageFiles.every(file => !!file);
            if (!hasAllImages) {
                showNotification('Please choose all 4 product images.');
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
                renderCustomProductsOnShop();
            } catch (err) {
                showNotification('Network error saving product.');
            }
        });
    }

    renderAdminLists();
}

function updateAuthUI() {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    const existing = document.getElementById('nav-user');
    if (existing) existing.remove();
    const existingAdmin = document.getElementById('nav-admin');
    if (existingAdmin) existingAdmin.remove();
    const li = document.createElement('li');
    li.id = 'nav-user';
    li.style.padding = '0 8px';
    if (isSignedIn()) {
        const user = getCurrentUser();
        li.innerHTML = `<a href="profile.html" title="Profile: ${user.name}"><i class="fa-solid fa-circle-user"></i></a>`;
        nav.appendChild(li);

        if (isSuperiorAccount()) {
            const adminLi = document.createElement('li');
            adminLi.id = 'nav-admin';
            adminLi.style.padding = '0 8px';
            adminLi.innerHTML = `<a href="admin.html" title="Admin Panel"><i class="fa-solid fa-shield-halved"></i></a>`;
            nav.appendChild(adminLi);
        }
    } else {
        li.innerHTML = `<a href="signin.html?redirect=profile.html" title="Sign In"><i class="fa-solid fa-circle-user"></i></a>`;
        nav.appendChild(li);
    }
}

function getProfileSettings() {
    const raw = localStorage.getItem('w_profile_settings');
    return raw ? JSON.parse(raw) : {
        newsletter: false,
        orderUpdates: true,
        twoFactor: false,
        publicWishlist: false
    };
}

function saveProfileSettings(settings) {
    localStorage.setItem('w_profile_settings', JSON.stringify(settings));
}
// Wishlist (persistent in localStorage)
function getWishlist() {
    const raw = localStorage.getItem('w_wishlist');
    return raw ? JSON.parse(raw) : [];
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
        btn.innerHTML = active ? 'âˆ’' : '+';
        if (active) {
            btn.style.color = '#c79a4a';
            btn.style.transform = 'scale(1.25)';
        } else {
            btn.style.color = '#777';
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
            <div style="text-align:center; padding:40px 0; color:#666; grid-column: 1 / -1;">
                <p>Sign in to view your wishlist</p>
                <a href="signin.html" class="normal" style="display:inline-block; margin-top:12px; padding:10px 24px; background:#c79a4a; color:#fff; border-radius:4px;">Sign In</a>
            </div>
        `;
        return;
    }
    const ids = getWishlist();
    if (ids.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:40px 0; color:#666; grid-column: 1 / -1;">Your wishlist is empty.</p>`;
        return;
    }
    const html = ids.map(id => {
        const p = products.find(x => x.id === id) || products[0];
        return `
            <div class="pro" data-product-id="${p.id}" style="position:relative;">
                <img src="${p.image}" alt="">
                <div class="des">
                    <span>adidas</span>
                    <h5>${p.name}</h5>
                    <div class="star">
                        <i class="fas fa-star"></i>
                        <i class="fas fa-star"></i>
                        <i class="fas fa-star"></i>
                        <i class="fas fa-star"></i>
                        <i class="fas fa-star-half-alt"></i>
                    </div>
                    <h4>$${formatMoney(p.price)}</h4>
                </div>
                <button class="btn-wishlist active" data-product-id="${p.id}" title="Remove from wishlist">âˆ’</button>
                <div class="wishlist-card-actions">
                    <a class="wishlist-cart-btn" href="#" data-product-id="${p.id}"><i class="fa-solid fa-cart-shopping"></i> Add to Cart</a>
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = html;
    
    // Attach remove handlers (allow clicking the top-right "âˆ’" on wishlist cards)
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

    if (!isSignedIn()) {
        const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `signin.html?redirect=${redirectUrl}`;
        return;
    }

    const user = getCurrentUser();
    const settings = getProfileSettings();
    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    const newsletterInput = document.getElementById('profile-newsletter');
    const orderUpdatesInput = document.getElementById('profile-order-updates');
    const twoFactorInput = document.getElementById('profile-two-factor');
    const publicWishlistInput = document.getElementById('profile-public-wishlist');
    const signoutBtn = document.getElementById('profile-signout');
    const form = document.getElementById('profile-form');

    if (nameInput) nameInput.value = user?.name || '';
    if (emailInput) emailInput.value = user?.email || '';
    if (newsletterInput) newsletterInput.checked = !!settings.newsletter;
    if (orderUpdatesInput) orderUpdatesInput.checked = settings.orderUpdates !== false;
    if (twoFactorInput) twoFactorInput.checked = !!settings.twoFactor;
    if (publicWishlistInput) publicWishlistInput.checked = !!settings.publicWishlist;

    if (form) {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const nextName = (nameInput?.value || '').trim();
            const nextEmail = (emailInput?.value || '').trim();
            if (!nextName || !nextEmail) {
                showNotification('Please fill in your name and email.');
                return;
            }

            localStorage.setItem('w_user', JSON.stringify({ name: nextName, email: nextEmail }));
            saveProfileSettings({
                newsletter: !!newsletterInput?.checked,
                orderUpdates: !!orderUpdatesInput?.checked,
                twoFactor: !!twoFactorInput?.checked,
                publicWishlist: !!publicWishlistInput?.checked
            });
            updateAuthUI();
            showNotification('Profile settings saved.');
        });
    }

    if (signoutBtn) {
        signoutBtn.addEventListener('click', () => {
            signOutUser();
            window.location.href = 'signin.html';
        });
    }
}
// Setup checkout button (requires sign-in)
function setupCheckoutButton() {
    const checkoutBtn = document.querySelector('#subtotal button.normal');
    
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            if (cart.items.length === 0) {
                showNotification('Your cart is empty');
                return;
            }
            if (!isSignedIn()) {
                const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `signin.html?redirect=${redirectUrl}`;
                return;
            }
            
            const total = cart.getTotal() - discountAmount;
            showPaymentModal(total);
        });
    }
}
function showPaymentModal(total) {
    const modal = document.getElementById('payment-modal');
    const amountSpan = document.getElementById('payment-amount');
    
    if (modal && amountSpan) {
        amountSpan.textContent = formatMoney(total);
        modal.style.display = 'flex';
    }
}
function closePaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}
function processPayment() {
    const total = cart.getTotal() - discountAmount;
    showNotification(`Payment of $${formatMoney(total)} successful!`);
    
    if (appliedCoupon) {
        addUsedCoupon(appliedCoupon);
    }
    
    setTimeout(() => {
        cart.clear();
        appliedCoupon = null;
        discountAmount = 0;
        displayCartItems();
        updateCartCount();
        closePaymentModal();
        showNotification('Order placed! Redirecting home...');
        
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }, 1500);
}
// Setup single product page
function setupSingleProduct() {
    const addToCartBtn = document.querySelector('#add-single-product') || document.querySelector('#prodetails .single-pro-details button.normal');
    const quantityInput = document.querySelector('#product-quantity') || document.querySelector('#prodetails .single-pro-details input[type="number"]');
    
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => {
            const quantity = parseInt(quantityInput ? quantityInput.value : 1) || 1;
            let product = window.currentProduct || products[0];
            
            cart.addItem(product, quantity);
            showNotification(`${product.name} added to cart!`);
            updateCartCount();
        });
    }
}
window.addEventListener('storage', (event) => {
    if (!event.key) return;

    if (event.key === 'w_custom_events') {
        renderEventsPage();
        renderEventDetailPage();
        if (document.getElementById('admin-panel')) renderAdminLists();
    }

    if (event.key === 'w_custom_products') {
        syncProductsFromStorage();
        renderCustomProductsOnShop();
        if (document.getElementById('admin-panel')) renderAdminLists();
    }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.allSettled([
            fetchGlobalProducts(),
            fetchGlobalEvents()
        ]);
    } catch (err) {}
    syncProductsFromStorage();
    renderCustomProductsOnShop();
    renderEventsPage();
    renderEventDetailPage();
    renderAdminPage();
    showIntroSplashIfNeeded();
    initScrollReveal();
    initHomepageParallax();
    setupAddToCartButtons();
    displayCartItems();
    updateCartCount();
    setupSingleProduct();
    setupCouponSystem();
    setupCheckoutButton();
    // Auth + wishlist UI
    updateAuthUI();
    
    // Only update "+" wishlist buttons on non-wishlist pages
    if (!isWishlistPage()) {
        updateWishlistButtons();
    }
    
    // Render the wishlist page if we're on it
    renderWishlistPage();
    renderProfilePage();
    
    // Setup payment form submission
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
        paymentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            processPayment();
        });
        
        const cardInput = paymentForm.querySelector('input[placeholder="1234 5678 9012 3456"]');
        if (cardInput) {
            cardInput.addEventListener('input', (e) => {
                const value = e.target.value.replace(/\s+/g, '');
                const formatted = value.replace(/(\d{4})/g, '$1 ').trim();
                e.target.value = formatted;
            });
        }
        
        const expiryInput = paymentForm.querySelector('input[placeholder="MM/YY"]');
        if (expiryInput) {
            expiryInput.addEventListener('input', (e) => {
                const value = e.target.value.replace(/\D/g, '');
                if (value.length >= 2) {
                    e.target.value = value.slice(0, 2) + '/' + value.slice(2, 4);
                } else {
                    e.target.value = value;
                }
            });
        }
    }
});

function showIntroSplashIfNeeded() {
    if (!document.body) return;

    const intro = document.createElement('div');
    intro.id = 'site-intro';
    intro.innerHTML = `
        <div class="intro-logo-wrap" aria-hidden="true">
            <img class="intro-logo" src="img/logo.png" alt="WholeHeartedHealth logo">
        </div>
    `;
    document.body.appendChild(intro);

    requestAnimationFrame(() => {
        setTimeout(() => {
            intro.classList.add('hide');
            setTimeout(() => {
                if (intro.parentNode) intro.parentNode.removeChild(intro);
            }, 760);
        }, 1400);
    });
}

function initScrollReveal() {
    const selectors = [
        'section:not(#header):not(#site-intro):not(#hero) > *',
        '.pro-container .pro',
        '#feature .fe-box',
        '#blog .blog-box',
        '#hero h1',
        '#hero .hero-kicker',
        '#hero .hero-sub',
        '#hero .hero-actions',
        '#hero .hero-logo-layer'
    ];

    const targets = Array.from(new Set(
        Array.from(document.querySelectorAll(selectors.join(',')))
    )).filter(el => (
        el instanceof HTMLElement
        && !el.closest('#header')
        && !el.closest('#site-intro')
        && !el.classList.contains('hero-parallax')
        && !el.matches('section, .pro-container, .pro-container-wrap')
    ));

    if (!targets.length) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const groupedTargets = new Map();
    targets.forEach(el => {
        const groupRoot = el.closest('.pro-container, #feature, #blog, #form-details, footer, section') || el.parentElement || document.body;
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

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
        });
    }, {
        threshold: 0.14,
        rootMargin: '0px 0px -10% 0px'
    });

    targets.forEach(el => observer.observe(el));
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




