const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');

// Load environment variables from .env if present
try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    });
} catch {
    // Environment variables supplied by the host or defaults
}

const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.join(__dirname, 'data.json');
const uploadsDir = path.join(__dirname, 'uploads');

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
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per image
});

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'qwerty@qwerty').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456789';

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Block access to private system files
const privateFiles = new Set(['/data.json', '/server.js', '/package.json', '/package-lock.json', '/.env', '/render.yaml']);
app.use((req, res, next) => {
    if (privateFiles.has(req.path)) return res.sendStatus(404);
    next();
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Helpers for data persistence
function readData() {
    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            products: Array.isArray(parsed.products) ? parsed.products : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
        };
    } catch (err) {
        return { products: [], events: [], sessions: [] };
    }
}

function writeData(data) {
    const tempPath = `${dataPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dataPath);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getSessionUser(req) {
    const token = req.cookies?.whh_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const data = readData();
    const session = data.sessions.find(s => s.tokenHash === hashToken(token) && s.expiresAt > Date.now());
    return session ? session.user : null;
}

function requireAdmin(req, res, next) {
    const user = getSessionUser(req);
    if (!user || user.role !== 'superior') {
        return res.status(403).json({ error: 'Superior administrator access required.' });
    }
    req.currentUser = user;
    next();
}

// ---------------- AUTH API ----------------
app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    res.json({ user });
});

app.post('/api/auth/signin', (req, res) => {
    const { email, password } = req.body || {};
    const normEmail = String(email || '').trim().toLowerCase();
    const isSuperior = normEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD;

    if (!normEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = {
        email: normEmail,
        name: normEmail.split('@')[0],
        role: isSuperior ? 'superior' : 'user'
    };

    const token = crypto.randomBytes(32).toString('hex');
    const data = readData();
    data.sessions = data.sessions.filter(s => s.expiresAt > Date.now());
    data.sessions.push({
        tokenHash: hashToken(token),
        user,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    writeData(data);

    res.cookie('whh_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, user, token });
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

app.post('/api/products', requireAdmin, productUploadFields, (req, res) => {
    const name = (req.body.name || '').trim();
    const price = parseFloat(req.body.price);
    const category = (req.body.category || 'general').trim();
    const description = (req.body.description || '').trim();

    if (!name || isNaN(price) || price < 0) {
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

    const defaultImg = uploadedFiles[0] || req.body.image || 'img/products/f1.jpg';
    const imagesList = uploadedFiles.length > 0 ? uploadedFiles : [defaultImg];

    const data = readData();
    const maxExistingId = data.products.reduce((max, p) => (typeof p.id === 'number' && p.id > max ? p.id : max), 0);
    const newProduct = {
        id: maxExistingId + 1,
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

app.post('/api/events', requireAdmin, upload.single('imageFile'), (req, res) => {
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

// Serve frontend static files
app.use(express.static(__dirname));

// Fallback for root
app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`WholeHeartedHealth server is running on port ${port}`);
});
