const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const cookieParser = require('cookie-parser');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

// Load environment variables from .env if present
try {
    if (process.env.NODE_ENV !== 'test') fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (match && process.env[match[1]] === undefined) {
            process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    });
} catch {
    // Environment variables supplied by the host or defaults
}

const app = express();
// Express 4 does not automatically forward rejected async handlers.
for (const method of ['get', 'post', 'patch', 'delete', 'put']) {
    const original = app[method].bind(app);
    app[method] = (route, ...handlers) => original(route, ...handlers.map(handler =>
        typeof handler === 'function' && handler.constructor.name === 'AsyncFunction'
            ? (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next) : handler));
}
const port = process.env.PORT || 3000;
const dataPath = process.env.DATA_PATH || path.join(__dirname, 'data.json');
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
const databaseUrl = process.env.DATABASE_URL || '';
const pool = databaseUrl ? new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
}) : null;
let databaseState = null;
let databaseDirty = false;
let requestQueue = Promise.resolve();
let persistenceReady = !pool;

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for uploaded product and event images
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg';
        const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
        const extension = path.extname(file.originalname || '').toLowerCase();
        cb(null, allowed[extension] === file.mimetype);
    }
});

function verifyUploadedImages(req, res, next) {
    const files = [...Object.values(req.files || {}).flat(), ...(req.file ? [req.file] : [])];
    const valid = files.every(file => {
        const buffer = Buffer.alloc(12);
        const descriptor = fs.openSync(file.path, 'r');
        try { fs.readSync(descriptor, buffer, 0, 12, 0); } finally { fs.closeSync(descriptor); }
        if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
        if (file.mimetype === 'image/gif') return buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a';
        if (file.mimetype === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
        return false;
    });
    if (!valid) {
        files.forEach(file => fs.unlinkSync(file.path));
        return res.status(400).json({ error: 'Only valid image files are accepted.' });
    }
    next();
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const signinAttempts = new Map();

app.disable('x-powered-by');
function allowedRequestOrigin(req) {
    const origin = req.get('origin');
    if (origin === new URL(publicBaseUrl(req)).origin) return true;
    if (process.env.NODE_ENV === 'production') return false;
    try {
        const source = new URL(origin);
        const target = new URL(`${req.protocol}://${req.get('host')}`);
        const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
        return loopback(source.hostname) && loopback(target.hostname) && source.origin === target.origin;
    } catch { return false; }
}

app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') &&
        !allowedRequestOrigin(req)) {
        return res.status(403).json({ error: 'This website address does not match the server configuration. Open the configured website address or ask the owner to check PUBLIC_BASE_URL.' });
    }
    next();
});
const requestLimits = new Map();
app.use('/api', (req, res, next) => {
    if (!/auth|newsletter\/subscribe|support-requests/.test(req.path) || req.method !== 'POST') return next();
    const now = Date.now();
    for (const [key, value] of requestLimits) if (value.until < now) requestLimits.delete(key);
    const key = req.ip;
    const entry = requestLimits.get(key) || { count: 0, until: now + 15 * 60000 };
    requestLimits.set(key, entry);
    if (++entry.count > 40) {
        res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
});
// Serialize state access, lock the database row, and commit before acknowledging requests.
// This small-site store deliberately favors correctness over parallel write throughput.
app.use('/api', (req, res, next) => {
    if (!pool) return next();
    const run = async () => {
        let client;
        const end = res.end.bind(res);
        try {
            client = await pool.connect();
            await client.query('BEGIN');
            const result = await client.query('SELECT data FROM wholehearted_state WHERE id = 1 FOR UPDATE');
            databaseState = normalizeData(result.rows[0].data);
            databaseDirty = false;
        } catch (error) {
            if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
            res.status(503).json({ error: 'Storage is unavailable. Please try again.' });
            return;
        }
        await new Promise(resolve => {
            let ended = false;
            res.end = (...args) => {
                if (ended) return res;
                ended = true;
                (async () => {
                    try {
                        if (databaseDirty) await client.query('UPDATE wholehearted_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(databaseState)]);
                        await client.query('COMMIT');
                        end(...args);
                    } catch (error) {
                        await client.query('ROLLBACK').catch(() => {});
                        res.removeHeader('Content-Length');
                        res.removeHeader('Set-Cookie');
                        res.statusCode = 503;
                        end(JSON.stringify({ error: 'Your changes could not be saved. Please try again.' }));
                    } finally { client.release(); resolve(); }
                })();
                return res;
            };
            next();
        });
    };
    requestQueue = requestQueue.then(run, run);
});
app.use(cookieParser());
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const header = req.get('stripe-signature') || '';
    if (!secret) return res.status(503).end();
    const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
    const signatures = [...header.matchAll(/(?:^|,)v1=([a-f0-9]{64})/g)].map(match => match[1]);
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures.length) {
        return res.status(400).end();
    }
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${req.body.toString('utf8')}`).digest();
    if (!signatures.some(signature => crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected))) {
        return res.status(400).end();
    }
    const event = JSON.parse(req.body.toString('utf8'));
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) &&
        event.data?.object?.payment_status === 'paid') {
        const data = readData();
        const order = data.orders.find(o => o.sessionId === event.data.object.id);
        if (order && order.status === 'pending') {
            order.status = 'paid';
            order.paidAt = new Date().toISOString();
            order.amountTotal = event.data.object.amount_total;
            order.currency = event.data.object.currency;
            order.shippingDetails = event.data.object.collected_information?.shipping_details || event.data.object.shipping_details || null;
            writeData(data);
        }
    }
    res.json({ received: true });
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir, { dotfiles: 'deny', setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff') }));

const MENU_CATALOG = [
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "home",
        "label": "Home",
        "url": "index",
        "icon": "fa-house"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "shop",
        "label": "Shop",
        "url": "shop",
        "icon": "fa-store"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "about",
        "label": "About",
        "url": "about",
        "icon": "fa-heart"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "contact",
        "label": "Contact",
        "url": "contact",
        "icon": "fa-envelope"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "text",
        "id": "events",
        "label": "Upcoming Events",
        "url": "events",
        "icon": "fa-calendar-days"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "wishlist",
        "label": "Wishlist",
        "url": "wishlist",
        "icon": "fa-clipboard-list"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "cart",
        "label": "Shopping bag",
        "url": "cart",
        "icon": "fa-bag-shopping"
    },
    {
        "visible": true,
        "audience": "everyone",
        "presentation": "icon",
        "id": "account",
        "label": "Your portal / Sign in",
        "url": "profile",
        "icon": "fa-circle-user"
    },
    {
        "visible": true,
        "audience": "admins",
        "presentation": "icon",
        "id": "admin",
        "label": "Admin panel",
        "url": "admin",
        "icon": "fa-shield-halved"
    },
    {
        "visible": false,
        "audience": "everyone",
        "presentation": "text",
        "id": "help",
        "label": "Help & ordering",
        "url": "help",
        "icon": "fa-circle-question"
    }
];
function normalizeNavigation(saved) {
    const source = Array.isArray(saved) ? saved : [];
    const seen = new Set();
    const ordered = [...source, ...MENU_CATALOG];
    return ordered.flatMap(item => {
        const definition = MENU_CATALOG.find(entry => entry.id === item?.id);
        if (!definition || seen.has(definition.id)) return [];
        seen.add(definition.id);
        return [{ ...definition,
            visible: typeof item.visible === 'boolean' ? item.visible : definition.visible,
            audience: definition.id === 'admin' ? 'admins' : ['everyone','guests','members','admins'].includes(item.audience) ? item.audience : definition.audience,
            presentation: ['text','icon'].includes(item.presentation) ? item.presentation : definition.presentation
        }];
    });
}

// Helpers for data persistence
function readData() {
    if (pool) {
        if (!databaseState) throw new Error('Database is still starting.');
        return structuredClone(databaseState);
    }
    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            products: Array.isArray(parsed.products) ? parsed.products : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            users: Array.isArray(parsed.users) ? parsed.users : [],
            orders: Array.isArray(parsed.orders) ? parsed.orders : [],
            subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
            supportRequests: Array.isArray(parsed.supportRequests) ? parsed.supportRequests : [],
            tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
            navigation: normalizeNavigation(parsed.navigation)
        };
    } catch (err) {
        throw new Error(`Cannot read data store: ${err.message}`);
    }
}

function writeData(data) {
    if (pool) {
        databaseState = structuredClone(data);
        databaseDirty = true;
        return;
    }
    const tempPath = `${dataPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dataPath);
}

function normalizeData(data = {}) {
    return {
        products: Array.isArray(data.products) ? data.products : [],
        events: Array.isArray(data.events) ? data.events : [],
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        users: Array.isArray(data.users) ? data.users : [],
        orders: Array.isArray(data.orders) ? data.orders : [],
        subscribers: Array.isArray(data.subscribers) ? data.subscribers : [],
        supportRequests: Array.isArray(data.supportRequests) ? data.supportRequests : [],
        tokens: Array.isArray(data.tokens) ? data.tokens : [],
        navigation: normalizeNavigation(data.navigation)
    };
}

async function initializePersistence() {
    if (process.env.NODE_ENV === 'production' && (!pool || !process.env.PUBLIC_BASE_URL?.startsWith('https://'))) throw new Error('Production requires DATABASE_URL and an HTTPS PUBLIC_BASE_URL.');
    if (!pool) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS wholehearted_state (
        id integer PRIMARY KEY CHECK (id = 1),
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    const existing = await pool.query('SELECT data FROM wholehearted_state WHERE id = 1');
    if (existing.rowCount) {
        databaseState = normalizeData(existing.rows[0].data);
    } else {
        const seed = normalizeData(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
        await pool.query('INSERT INTO wholehearted_state (id, data) VALUES (1, $1::jsonb)', [JSON.stringify(seed)]);
        databaseState = seed;
    }
    persistenceReady = true;
}

app.use('/api', (_req, res, next) => {
    if (!persistenceReady) return res.status(503).json({ error: 'Service is starting. Please try again.' });
    next();
});

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    const [salt, digest] = stored.split(':');
    if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
    return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
}

function publicBaseUrl(req) {
    return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function createOneTimeToken(data, type, email, ttlMs) {
    const token = crypto.randomBytes(32).toString('hex');
    data.tokens = data.tokens.filter(item => !(type !== 'unsubscribe' && item.type === type && item.email === email) && item.expiresAt > Date.now());
    data.tokens.push({ id: crypto.randomUUID(), type, email, tokenHash: hashToken(token), expiresAt: Date.now() + ttlMs });
    return token;
}

function consumeOneTimeToken(data, type, token) {
    const tokenHash = hashToken(String(token || ''));
    const index = data.tokens.findIndex(item => item.type === type && item.tokenHash === tokenHash && item.expiresAt > Date.now());
    if (index < 0) return null;
    const [record] = data.tokens.splice(index, 1);
    return record;
}

function mailTransport() {
    if (!process.env.SMTP_HOST) return nodemailer.createTransport({ jsonTransport: true });
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
}

function escapeEmailHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
async function sendEmail({ to, subject, text, html }) {
    const from = process.env.EMAIL_FROM || 'Whole-Hearted Health <no-reply@localhost>';
    if (process.env.RESEND_API_KEY) {
        if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM must use a verified Resend domain.');
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject, text, html })
        });
        if (!response.ok) throw new Error(`Email provider rejected the message (${response.status}).`);
        return;
    }
    if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) throw new Error('Configure RESEND_API_KEY and EMAIL_FROM.');
    const info = await mailTransport().sendMail({ from, to, subject, text, html });
    if (!process.env.SMTP_HOST) console.info('Development email:', info.message);
}

function safeUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role || 'user',
        verified: !!user.verifiedAt, newsletterOptIn: !!user.newsletterOptIn };
}

function createSession(res, data, user) {
    const token = crypto.randomBytes(32).toString('hex');
    data.sessions = data.sessions.filter(s => s.expiresAt > Date.now());
    const publicUser = safeUser(user);
    data.sessions.push({ version: 3, tokenHash: hashToken(token), user: publicUser, expiresAt: Date.now() + 30 * 86400000 });
    writeData(data);
    res.cookie('whh_session', token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
        path: '/', maxAge: 30 * 86400000
    });
    res.json({ success: true, user: publicUser });
}

function getSessionUser(req) {
    const token = req.cookies?.whh_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const data = readData();
    const session = data.sessions.find(s => s.version === 3 && s.tokenHash === hashToken(token) && s.expiresAt > Date.now());
    return session ? session.user : null;
}

function requireAdmin(req, res, next) {
    const user = getSessionUser(req);
    if (!user || !['admin', 'owner'].includes(user.role)) {
        return res.status(403).json({ error: 'Administrator access required.' });
    }
    req.currentUser = user;
    next();
}

function requireOwner(req, res, next) {
    const user = getSessionUser(req);
    if (!user || user.role !== 'owner') return res.status(403).json({ error: 'Owner access required.' });
    req.currentUser = user;
    next();
}

function requireUser(req, res, next) {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    req.currentUser = user;
    next();
}

// ---------------- AUTH API ----------------
app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    res.json({ user });
});

app.post('/api/auth/profile', (req, res) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Enter a name and valid email.' });
    }
    if (email !== user.email) {
        return res.status(400).json({ error: 'Email changes require contacting support. You can update your name here.' });
    }
    const data = readData();
    if (data.users.some(account => account.email === email && account.email !== user.email) ||
        (email === ADMIN_EMAIL && user.role !== 'owner')) {
        return res.status(409).json({ error: 'That email is already in use.' });
    }
    if (user.role !== 'owner') {
        const account = data.users.find(account => account.email === user.email);
        if (!account) return res.status(404).json({ error: 'Account not found.' });
        account.name = name;
        if (account.email !== email) {
            account.email = email;
            account.verifiedAt = null;
        }
    }
    for (const session of data.sessions) {
        if (session.user.email === user.email) {
            session.user = { ...session.user, name, email };
        }
    }
    writeData(data);
    const savedUser = data.users.find(account => account.email === email) || { ...user, name, email };
    res.json({ success: true, user: safeUser(savedUser) });
});

app.post('/api/auth/signin', (req, res) => {
    const { email, password } = req.body || {};
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (signinAttempts.size > 1000) {
        for (const [key, value] of signinAttempts) {
            if (value.expiresAt <= Date.now()) signinAttempts.delete(key);
        }
        if (signinAttempts.size > 1000) signinAttempts.clear();
    }
    const attemptKey = `${req.ip}:${normEmail}`;
    const attempt = signinAttempts.get(attemptKey);
    if (attempt && attempt.expiresAt > Date.now() && attempt.count >= 5) {
        return res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
    }

    const data = readData();
    const isOwner = !!(ADMIN_EMAIL && ADMIN_PASSWORD && normEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD);
    const account = data.users.find(u => u.email === normEmail);
    if (!isOwner && (!account || !verifyPassword(password, account.passwordHash))) {
        const current = attempt && attempt.expiresAt > Date.now() ? attempt : { count: 0, expiresAt: Date.now() + 15 * 60000 };
        current.count += 1;
        signinAttempts.set(attemptKey, current);
        return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!isOwner && !account.verifiedAt) {
        return res.status(403).json({ error: 'Verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED' });
    }
    signinAttempts.delete(attemptKey);
    const user = isOwner
        ? { id: 'owner', email: normEmail, name: 'Owner', role: 'owner', verifiedAt: Date.now() }
        : account;
    createSession(res, data, user);
});

app.post('/api/auth/register', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
        return res.status(400).json({ error: 'Enter a name, valid email, and password.' });
    }
    const data = readData();
    if (email === ADMIN_EMAIL || data.users.some(u => u.email === email)) {
        return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), role: 'user',
        verifiedAt: null, newsletterOptIn: req.body?.newsletterOptIn === true, createdAt: new Date().toISOString() };
    data.users.push(user);
    const token = createOneTimeToken(data, 'verify-account', email, 24 * 3600000);
    writeData(data);
    const link = `${publicBaseUrl(req)}/signin?verify=${encodeURIComponent(token)}`;
    try {
        await sendEmail({ to: email, subject: 'Verify your Whole-Hearted Health account',
            text: `Verify your account: ${link}`, html: `<p>Welcome to Whole-Hearted Health.</p><p><a href="${link}">Verify your account</a></p>` });
    } catch (err) {
        return res.status(502).json({ error: 'Your account was created, but the verification email could not be sent. Use resend verification.' });
    }
    res.status(201).json({ success: true, requiresVerification: true, message: 'Check your email to verify your account.' });
});

app.post('/api/auth/verify', (req, res) => {
    const data = readData();
    const record = consumeOneTimeToken(data, 'verify-account', req.body?.token);
    if (!record) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    const user = data.users.find(item => item.email === record.email);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    user.verifiedAt = new Date().toISOString();
    if (user.newsletterOptIn) {
        let subscriber = data.subscribers.find(item => item.email === user.email);
        if (!subscriber) {
            subscriber = { id: crypto.randomUUID(), email: user.email, subscribedAt: new Date().toISOString() };
            data.subscribers.push(subscriber);
        }
        subscriber.verifiedAt = user.verifiedAt;
    }
    writeData(data);
    res.json({ success: true, message: 'Email verified. You can now sign in.' });
});

app.post('/api/auth/resend-verification', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const data = readData();
    const user = data.users.find(item => item.email === email);
    if (user && !user.verifiedAt) {
        const token = createOneTimeToken(data, 'verify-account', email, 24 * 3600000);
        writeData(data);
        const link = `${publicBaseUrl(req)}/signin?verify=${encodeURIComponent(token)}`;
        await sendEmail({ to: email, subject: 'Verify your Whole-Hearted Health account', text: `Verify your account: ${link}` });
    }
    res.json({ success: true, message: 'If an unverified account exists, a new email has been sent.' });
});

app.post('/api/auth/forgot-password', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const data = readData();
    const user = data.users.find(item => item.email === email && item.verifiedAt);
    if (user) {
        const token = createOneTimeToken(data, 'reset-password', email, 60 * 60000);
        writeData(data);
        const link = `${publicBaseUrl(req)}/signin?reset=${encodeURIComponent(token)}`;
        await sendEmail({ to: email, subject: 'Reset your Whole-Hearted Health password',
            text: `Reset your password within one hour: ${link}` });
    }
    res.json({ success: true, message: 'If a verified account exists, a reset link has been sent.' });
});

app.post('/api/auth/reset-password', (req, res) => {
    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ error: 'Enter a password.' });
    const data = readData();
    const record = consumeOneTimeToken(data, 'reset-password', req.body?.token);
    if (!record) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    const user = data.users.find(item => item.email === record.email);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    user.passwordHash = hashPassword(password);
    data.sessions = data.sessions.filter(session => session.user.email !== user.email);
    writeData(data);
    res.json({ success: true, message: 'Password reset. Sign in with your new password.' });
});

app.post('/api/auth/signout', (req, res) => {
    const token = req.cookies?.whh_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
        const data = readData();
        data.sessions = data.sessions.filter(s => s.tokenHash !== hashToken(token));
        writeData(data);
    }
    res.clearCookie('whh_session', { path: '/' });
    res.json({ success: true });
});

// Checkout is opt-in; pausing new payments leaves existing orders accessible.
function checkoutAvailability() {
    const enabled = process.env.CHECKOUT_ENABLED === 'true' && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
    return { enabled, message: enabled ? 'Secure payment through Stripe.' : 'Online checkout is temporarily paused. You can still browse and save items in your cart.' };
}
app.get('/api/checkout/availability', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(checkoutAvailability());
});

// Stripe owns the payment page. Prices and names always come from the server catalog.
app.post('/api/checkout/session', async (req, res) => {
    const availability = checkoutAvailability();
    if (!availability.enabled) return res.status(503).json({ error: availability.message });
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in before checkout.' });
    if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'Checkout is not configured yet.' });
    }
    const requested = req.body?.items;
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 100) {
        return res.status(400).json({ error: 'Your cart is empty or too large.' });
    }
    const data = readData();
    const items = [];
    for (const item of requested) {
        const quantity = Number(item.quantity);
        const size = String(item.size || '').trim();
        const product = data.products.find(p => p.id === item.id);
        if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999 ||
            !Number.isFinite(product.price) || product.price <= 0) {
            return res.status(400).json({ error: 'Your cart contains an unavailable product or invalid quantity. Refresh it and try again.' });
        }
        if (size && !['Small', 'Medium', 'Large', 'XL', 'XXL'].includes(size)) {
            return res.status(400).json({ error: 'Your cart contains an invalid size.' });
        }
        items.push({ id: product.id, name: product.name, size, unitAmount: Math.round(product.price * 100), quantity });
    }
    const origin = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    if (!/^https?:\/\/[^/]+$/.test(origin) || (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))) {
        return res.status(503).json({ error: 'Checkout site URL is not configured.' });
    }
    const params = new URLSearchParams({
        mode: 'payment',
        success_url: `${origin}/cart?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/cart?checkout=cancel`,
        customer_email: user.email,
        'shipping_address_collection[allowed_countries][0]': 'US'
    });
    items.forEach((item, i) => {
        params.set(`line_items[${i}][price_data][currency]`, 'usd');
        params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
        params.set(`line_items[${i}][price_data][product_data][name]`, item.size ? `${item.name} — ${item.size}` : item.name);
        params.set(`line_items[${i}][quantity]`, String(item.quantity));
    });
    try {
        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });
        const session = await stripeResponse.json();
        if (!stripeResponse.ok || !session.id || !session.url) {
            return res.status(502).json({ error: session.error?.message || 'Stripe checkout is unavailable.' });
        }
        const currentData = readData();
        currentData.orders.push({ sessionId: session.id, email: user.email, items, status: 'pending', createdAt: new Date().toISOString() });
        writeData(currentData);
        res.json({ url: session.url });
    } catch (err) {
        res.status(502).json({ error: 'Stripe checkout is unavailable. Please try again.' });
    }
});

app.get('/api/checkout/status/:sessionId', async (req, res) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    const data = readData();
    const order = data.orders.find(o => o.sessionId === req.params.sessionId && o.email === user.email);
    if (!order) return res.status(404).json({ error: 'Checkout session not found.' });
    if (order.status === 'pending' && process.env.STRIPE_SECRET_KEY) {
        try {
            const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.sessionId)}`, {
                signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
            });
            if (response.ok) {
                const session = await response.json();
                if (session.payment_status === 'paid') {
                    const latestData = readData();
                    const latestOrder = latestData.orders.find(o => o.sessionId === order.sessionId);
                    if (latestOrder) {
                        latestOrder.status = 'paid';
                        latestOrder.paidAt = new Date().toISOString();
                        latestOrder.amountTotal = session.amount_total;
                        latestOrder.currency = session.currency;
                        latestOrder.shippingDetails = session.collected_information?.shipping_details || session.shipping_details || null;
                        writeData(latestData);
                        order.status = 'paid';
                    }
                }
            }
        } catch (err) { /* Keep the order pending when Stripe cannot be reached. */ }
    }
    res.json({ status: order.status });
});

app.get('/api/orders', (req, res) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    const orders = readData().orders
        .filter(order => order.email === user.email)
        .map(order => ({
            sessionId: order.sessionId, status: order.status,
            createdAt: order.createdAt,
            items: order.items.map(item => ({ name: item.name, quantity: item.quantity, size: item.size || '' }))
        }));
    res.json({ orders });
});

app.get('/api/portal', requireUser, (req, res) => {
    const data = readData();
    const email = req.currentUser.email;
    const orders = data.orders.filter(order => order.email === email).map(order => ({
        id: order.sessionId, status: order.status, progress: Number(order.progress || 0),
        note: order.note || '', createdAt: order.createdAt, paidAt: order.paidAt || null,
        items: order.items.map(item => ({ name: item.name, quantity: item.quantity, size: item.size || '' }))
    }));
    const requests = data.supportRequests.filter(item => item.email === email)
        .map(({ id, subject, message, status, createdAt, note }) => ({ id, subject, message, status, createdAt, note: note || '' }));
    res.json({ user: req.currentUser, orders, requests });
});

app.post('/api/support-requests', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || message.length < 10 || message.length > 5000) {
        return res.status(400).json({ error: 'Enter your name, email, subject, and a message of 10 to 5,000 characters.' });
    }
    const data = readData();
    const request = { id: crypto.randomUUID(), name, email, subject, message, status: 'pending', note: '', createdAt: new Date().toISOString() };
    data.supportRequests.push(request);
    writeData(data);
    if (ADMIN_EMAIL) {
        sendEmail({ to: ADMIN_EMAIL, subject: `Whole-Hearted Health request: ${subject}`,
            text: `${name} (${email}) wrote:\n\n${message}` }).catch(err => console.error('Owner email failed:', err.message));
    }
    res.status(201).json({ success: true, requestId: request.id });
});

app.post('/api/newsletter/subscribe', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    const data = readData();
    let subscriber = data.subscribers.find(item => item.email === email);
    if (!subscriber) {
        subscriber = { id: crypto.randomUUID(), email, verifiedAt: null, subscribedAt: new Date().toISOString() };
        data.subscribers.push(subscriber);
    }
    if (!subscriber.verifiedAt) {
        const token = createOneTimeToken(data, 'verify-newsletter', email, 24 * 3600000);
        writeData(data);
        const link = `${publicBaseUrl(req)}/profile?newsletter_verify=${encodeURIComponent(token)}`;
        await sendEmail({ to: email, subject: 'Confirm Whole-Hearted Health newsletter', text: `Confirm your subscription: ${link}` });
    }
    res.json({ success: true, message: 'Check your email to confirm your subscription.' });
});

app.post('/api/newsletter/verify', (req, res) => {
    const data = readData();
    const record = consumeOneTimeToken(data, 'verify-newsletter', req.body?.token);
    if (!record) return res.status(400).json({ error: 'This confirmation link is invalid or expired.' });
    const subscriber = data.subscribers.find(item => item.email === record.email);
    if (!subscriber) return res.status(404).json({ error: 'Subscription not found.' });
    subscriber.verifiedAt = new Date().toISOString();
    writeData(data);
    res.json({ success: true, message: 'Newsletter subscription confirmed.' });
});

app.post('/api/newsletter/unsubscribe', (req, res) => {
    const data = readData();
    const record = consumeOneTimeToken(data, 'unsubscribe', req.body?.token);
    const user = getSessionUser(req);
    const email = req.body?.token ? record?.email : user?.email;
    if (!email) return res.status(400).json({ error: 'Use the unsubscribe link from your email or sign in.' });
    data.subscribers = data.subscribers.filter(item => item.email !== email);
    writeData(data);
    res.json({ success: true, message: 'You have been unsubscribed.' });
});

app.get('/api/navigation', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ navigation: normalizeNavigation(readData().navigation) });
});
app.put('/api/admin/navigation', requireAdmin, (req, res) => {
    const items = req.body?.navigation;
    const audiences = ['everyone','guests','members','admins'];
    if (!Array.isArray(items) || items.length !== MENU_CATALOG.length ||
        new Set(items.map(item => item?.id)).size !== MENU_CATALOG.length ||
        items.some(item => !MENU_CATALOG.some(entry => entry.id === item?.id) || typeof item.visible !== 'boolean' ||
            !audiences.includes(item.audience) || !['text','icon'].includes(item.presentation) || (item.id === 'admin' && item.audience !== 'admins'))) {
        return res.status(400).json({ error: 'Choose valid visibility, audience, and display options for every menu item.' });
    }
    const data = readData();
    data.navigation = normalizeNavigation(items);
    writeData(data);
    res.json({ success: true, navigation: data.navigation });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
    const data = readData();
    res.json({
        role: req.currentUser.role,
        navigation: normalizeNavigation(data.navigation),
        navigationDefaults: MENU_CATALOG,
        orders: data.orders,
        requests: data.supportRequests,
        users: data.users.map(safeUser),
        subscribers: data.subscribers.map(item => ({ id: item.id, email: item.email, verified: !!item.verifiedAt, subscribedAt: item.subscribedAt }))
    });
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const data = readData();
    const order = data.orders.find(item => item.sessionId === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const allowed = ['pending', 'paid', 'processing', 'shipped', 'completed', 'canceled'];
    if (req.body?.status && !allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
    if (req.body?.status) order.status = req.body.status;
    if (req.body?.progress !== undefined) order.progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));
    if (req.body?.note !== undefined) order.note = String(req.body.note).trim().slice(0, 2000);
    writeData(data);
    res.json({ success: true, order });
});

app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const data = readData();
    const item = data.supportRequests.find(request => request.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Request not found.' });
    if (req.body?.status && !['pending', 'confirmed', 'completed'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
    if (req.body?.status) item.status = req.body.status;
    if (req.body?.note !== undefined) item.note = String(req.body.note).trim().slice(0, 2000);
    writeData(data);
    res.json({ success: true, request: item });
});

app.patch('/api/owner/users/:id/role', requireOwner, (req, res) => {
    const role = req.body?.role;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be user or admin.' });
    const data = readData();
    const user = data.users.find(item => item.id === req.params.id);
    if (!user || !user.verifiedAt) return res.status(404).json({ error: 'Verified user not found.' });
    user.role = role;
    data.sessions = data.sessions.filter(session => session.user.email !== user.email);
    writeData(data);
    res.json({ success: true, user: safeUser(user) });
});

app.delete('/api/owner/users/:id', requireOwner, (req, res) => {
    const data = readData();
    const user = data.users.find(item => item.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    data.users = data.users.filter(item => item.id !== user.id);
    data.tokens = data.tokens.filter(item => item.email !== user.email);
    data.sessions = data.sessions.filter(session => session.user.email !== user.email);
    data.orders = data.orders.filter(order => order.email !== user.email);
    data.supportRequests = data.supportRequests.filter(item => item.email !== user.email);
    data.subscribers = data.subscribers.filter(item => item.email !== user.email);
    writeData(data);
    res.json({ success: true });
});

app.delete('/api/admin/subscribers/:id', requireAdmin, (req, res) => {
    const data = readData();
    data.subscribers = data.subscribers.filter(item => item.id !== req.params.id);
    writeData(data);
    res.json({ success: true });
});

app.post('/api/admin/newsletter', requireAdmin, async (req, res) => {
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!subject || message.length < 10 || message.length > 10000) {
        return res.status(400).json({ error: 'Enter a subject and message of 10 to 10,000 characters.' });
    }
    const data = readData();
    const subscribers = data.subscribers.filter(item => item.verifiedAt);
    const deliveries = subscribers.map(item => ({ email: item.email,
        token: createOneTimeToken(data, 'unsubscribe', item.email, 365 * 86400000) }));
    writeData(data);
    const results = [];
    for (const item of deliveries) {
        try {
            const unsubscribeUrl = `${publicBaseUrl(req)}/profile?unsubscribe=${encodeURIComponent(item.token)}`;
            await sendEmail({ to: item.email, subject,
                text: `${message}\n\nUnsubscribe: ${unsubscribeUrl}`,
                html: `<div style="font-family:Arial,sans-serif;color:#34241f;line-height:1.6">${escapeEmailHTML(message).replace(/\r?\n/g, '<br>')}<p style="margin-top:24px;font-size:13px"><a href="${escapeEmailHTML(unsubscribeUrl)}" style="color:#8b5268">Unsubscribe</a></p></div>` });
            results.push({ status: 'fulfilled' });
        } catch { results.push({ status: 'rejected' }); }
        if (process.env.RESEND_API_KEY) await new Promise(resolve => setTimeout(resolve, 600));
    }
    res.json({ success: true, sent: results.filter(item => item.status === 'fulfilled').length,
        failed: results.filter(item => item.status === 'rejected').length });
});

app.delete('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const data = readData();
    const before = data.supportRequests.length;
    data.supportRequests = data.supportRequests.filter(item => item.id !== req.params.id);
    if (data.supportRequests.length === before) return res.status(404).json({ error: 'Request not found.' });
    writeData(data);
    res.json({ success: true });
});

function backupKey() {
    if (!process.env.BACKUP_SECRET) return null;
    return crypto.scryptSync(process.env.BACKUP_SECRET, 'wholehearted-backup-v1', 32);
}

function encryptBackup(data) {
    const key = backupKey();
    if (!key) throw new Error('BACKUP_SECRET is not configured.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}

function decryptBackup(payload) {
    const key = backupKey();
    if (!key) throw new Error('BACKUP_SECRET is not configured.');
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (parsed?.version !== 1) throw new Error('Unsupported backup version.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!data || !['products', 'events', 'users', 'orders', 'sessions', 'subscribers', 'supportRequests', 'tokens'].every(key => Array.isArray(data[key]))) throw new Error('Invalid backup data.');
    return normalizeData(data);
}

app.get('/api/owner/backup', requireOwner, (_req, res) => {
    try {
        res.type('application/json').attachment(`wholehearted-backup-${new Date().toISOString().slice(0, 10)}.json`).send(encryptBackup(readData()));
    } catch (err) { res.status(503).json({ error: err.message }); }
});

app.post('/api/owner/backup/preview', requireOwner, (req, res) => {
    try {
        const data = decryptBackup(req.body?.backup);
        res.json({ users: data.users.length, products: data.products.length, events: data.events.length,
            orders: data.orders.length, subscribers: data.subscribers.length, requests: data.supportRequests.length });
    } catch (err) { res.status(400).json({ error: 'Backup could not be decrypted or is invalid.' }); }
});

app.post('/api/owner/backup/restore', requireOwner, (req, res) => {
    try {
        const restored = decryptBackup(req.body?.backup);
        restored.sessions = [];
        restored.tokens = [];
        writeData(restored);
        res.clearCookie('whh_session', { path: '/' });
        res.json({ success: true, message: 'Backup restored. Sign in again.' });
    } catch (err) { res.status(400).json({ error: 'Backup could not be decrypted or is invalid.' }); }
});

// ---------------- PRODUCTS API ----------------
app.get('/api/products', (_req, res) => {
    const data = readData();
    res.json({ products: data.products });
});

const productUploadFields = upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'image4', maxCount: 1 },
    { name: 'images', maxCount: 8 }
]);

app.post('/api/products', requireAdmin, productUploadFields, verifyUploadedImages, (req, res) => {
    const name = (req.body.name || '').trim();
    const price = Number(req.body.price);
    const category = (req.body.category || 'general').trim();
    const description = (req.body.description || '').trim();

    if (!name || !Number.isFinite(price) || price <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(req.body.price))) {
        return res.status(400).json({ error: 'Valid product name and price are required.' });
    }

    const uploadedFiles = [];
    ['image1', 'image2', 'image3', 'image4'].forEach(fieldName => {
        if (req.files && req.files[fieldName] && req.files[fieldName][0]) {
            uploadedFiles.push(`/uploads/${req.files[fieldName][0].filename}`);
        }
    });
    if (req.files && req.files.images) {
        req.files.images.forEach(f => uploadedFiles.push(`/uploads/${f.filename}`));
    }

    const defaultImg = uploadedFiles[0] || req.body.image || 'img/logo.png';
    const imagesList = uploadedFiles.length > 0 ? uploadedFiles : [defaultImg];

    const data = readData();
    const maxExistingId = data.products.reduce((max, p) => (typeof p.id === 'number' && p.id > max ? p.id : max), 0);
    const newProduct = {
        id: Math.max(Date.now(), maxExistingId + 1),
        name,
        price,
        category,
        description,
        image: defaultImg,
        images: imagesList
    };

    data.products.push(newProduct);
    writeData(data);

    res.status(201).json({ success: true, product: newProduct });
});

for (const collection of ['products', 'events']) {
    app.patch(`/api/${collection}/:id`, requireAdmin, (req, res) => {
        const data = readData();
        const item = data[collection].find(item => String(item.id) === req.params.id);
        if (!item) return res.status(404).json({ error: 'Item not found.' });
        const fields = collection === 'products' ? ['name', 'category', 'description'] : ['name', 'date', 'time', 'location', 'description'];
        for (const field of fields) {
            if (req.body[field] !== undefined) {
                if (typeof req.body[field] !== 'string' || !req.body[field].trim() || req.body[field].length > 5000) return res.status(400).json({ error: `Enter a valid ${field}.` });
                item[field] = req.body[field].trim();
            }
        }
        if (collection === 'products' && req.body.price !== undefined) {
            const price = Number(req.body.price);
            if (!Number.isFinite(price) || price <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(req.body.price))) return res.status(400).json({ error: 'Enter a valid price.' });
            item.price = price;
        }
        writeData(data);
        res.json({ success: true, item });
    });
}

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const targetId = req.params.id;
    const data = readData();
    const initialLen = data.products.length;
    data.products = data.products.filter(p => String(p.id) !== String(targetId));

    if (data.products.length === initialLen) {
        return res.status(404).json({ error: 'Product not found.' });
    }

    writeData(data);
    res.json({ success: true });
});

// ---------------- EVENTS API ----------------
app.get('/api/events', (_req, res) => {
    const data = readData();
    res.json({ events: data.events });
});

app.post('/api/events', requireAdmin, upload.single('imageFile'), verifyUploadedImages, (req, res) => {
    const name = (req.body.name || '').trim();
    const date = (req.body.date || '').trim();
    const time = (req.body.time || '').trim();
    const location = (req.body.location || '').trim();
    const description = (req.body.description || '').trim();
    let image = (req.body.image || '').trim();

    if (req.file) {
        image = `/uploads/${req.file.filename}`;
    }

    if (!name || !image || !date || !time || !location || !description) {
        return res.status(400).json({ error: 'All event fields including an image are required.' });
    }

    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    const newEvent = { id, name, image, date, time, location, description };

    const data = readData();
    data.events.push(newEvent);
    writeData(data);

    res.status(201).json({ success: true, event: newEvent });
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
    const targetId = req.params.id;
    const data = readData();
    const initialLen = data.events.length;
    data.events = data.events.filter(e => String(e.id) !== String(targetId));

    if (data.events.length === initialLen) {
        return res.status(404).json({ error: 'Event not found.' });
    }

    writeData(data);
    res.json({ success: true });
});

// Only explicitly public files can be served. Never expose the project root:
// path deny-lists can be bypassed by URL encoding or case-insensitive filesystems.
app.get('/healthz', async (_req, res) => {
    try { if (pool) await pool.query('SELECT 1'); res.status(persistenceReady ? 200 : 503).json({ status: persistenceReady ? 'ok' : 'starting' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
});
app.use('/img', express.static(path.join(__dirname, 'img'), { dotfiles: 'deny' }));
// Keep old bookmarks working without maintaining duplicate pages.
const legacyPages = {
    '/portal': '/profile',
    '/portal.html': '/profile',
    '/blog.html': '/events',
    '/track': '/profile',
    '/track.html': '/profile',
    '/event-nutrition-qa-night.html': '/events',
    '/event-spring-wellness-workshop.html': '/events',
    '/event-summer-product-preview.html': '/events'
};
for (const [oldPath, destination] of Object.entries(legacyPages)) {
    app.get(oldPath, (req, res) => res.redirect(301, destination + req.originalUrl.slice(req.path.length)));
}
const publicFiles = [
    'index.html', 'shop.html', 'sproduct.html', 'cart.html', 'wishlist.html',
    'signin.html', 'profile.html', 'admin.html', 'about.html',
    'contact.html', 'events.html', 'event-detail.html',
    'help.html',
    'privacy.html', 'terms.html', 'style.css', 'script.js', 'admin-dashboard.js'
];
for (const file of publicFiles) {
    if (file.endsWith('.html')) {
        const cleanPath = '/' + file.slice(0, -5);
        app.get('/' + file, (req, res) => res.redirect(301, cleanPath + req.originalUrl.slice(req.path.length)));
        app.get(file === 'index.html' ? ['/', cleanPath] : cleanPath, (_req, res) => res.sendFile(path.join(__dirname, file)));
    } else {
        app.get('/' + file, (_req, res) => res.sendFile(path.join(__dirname, file)));
    }
}

app.use((error, _req, res, _next) => {
    console.error('Request failed:', error.message);
    if (!res.headersSent) res.status(error.status || 500).json({ error: 'The request could not be completed. Please try again.' });
});

if (require.main === module) {
    initializePersistence().then(() => {
        app.listen(port, () => console.log(`WholeHeartedHealth server is running on port ${port}`));
    }).catch(err => {
        console.error('Could not start persistence:', err.message);
        process.exitCode = 1;
    });
}

module.exports = app;
module.exports.initializePersistence = initializePersistence;
