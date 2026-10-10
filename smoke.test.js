// Tests must never load local credentials or contact configured email services.
process.env.NODE_ENV = 'test';
delete process.env.CHECKOUT_ENABLED;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whh-smoke-'));
process.env.DATA_PATH = path.join(directory, 'data.json');
process.env.ADMIN_EMAIL = 'admin@example.test';
process.env.ADMIN_PASSWORD = 'private-test-password';
process.env.RESEND_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'Whole-Hearted Health <test@example.test>';
process.env.BACKUP_SECRET = 'test-backup-secret';
fs.writeFileSync(process.env.DATA_PATH, JSON.stringify({
    products: [{ id: 1, name: 'Test item', price: 12.5, image: 'img/logo.png' }],
    events: [], sessions: [], users: [], orders: []
}));
const app = require('./server');

test('authentication, private files, and checkout use server-side data', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const originalFetch = global.fetch;
    const emails = [];
    global.fetch = async (url, options) => {
        if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(options.body)); return { ok: true }; }
        return originalFetch(url, options);
    };
    const emailFetch = global.fetch;
    const request = (route, body, cookie, method = 'POST') => originalFetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const tokenFromLastEmail = () => new URL(emails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.values().next().value;
    try {
        for (const route of ['/data.json', '/%64ata.json', '/SERVER.JS']) {
            assert.equal((await originalFetch(base + route)).status, 404);
        }
        const signin = async (password) => originalFetch(base + '/api/auth/signin', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'customer@example.test', password })
        });
        assert.equal((await request('/api/auth/register', {name:'Empty',email:'empty@example.test',password:''})).status, 400);
        assert.equal((await signin('wrong-password')).status, 401);
        const registration = await originalFetch(base + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Customer', email: 'customer@example.test', password: 'short' })
        });
        assert.equal(registration.status, 201);
        assert.equal((await signin('short')).status, 403);
        const verification = tokenFromLastEmail();
        assert.equal((await request('/api/auth/verify', { token: verification })).status, 200);
        assert.equal((await request('/api/auth/verify', { token: verification })).status, 400);
        const login = await signin('short');
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal((await signin('wrong-password')).status, 401);
        assert.equal((await signin('short')).status, 200);
        const profile = await originalFetch(base + '/api/auth/profile', {
            method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated Customer', email: 'customer@example.test' })
        });
        assert.equal(profile.status, 200);
        assert.equal((await profile.json()).user.name, 'Updated Customer');
        assert.equal((await originalFetch(base + '/api/orders')).status, 401);
        assert.equal((await originalFetch(base + '/api/checkout/session', {
            method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: 1, quantity: 1 }] })
        })).status, 503);

        assert.equal((await (await originalFetch(base + '/api/checkout/availability')).json()).enabled, false);
        process.env.STRIPE_SECRET_KEY = 'sk_test_local';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local';
        assert.equal((await request('/api/checkout/session', { items: [{ id: 1, quantity: 1 }] }, cookie)).status, 503);
        process.env.CHECKOUT_ENABLED = 'true';
        assert.equal((await (await originalFetch(base + '/api/checkout/availability')).json()).enabled, true);
        global.fetch = async (url, options) => {
            if (String(url).startsWith('https://api.stripe.com/')) {
                const body = new URLSearchParams(options.body);
                assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1250');
                assert.equal(body.get('line_items[0][quantity]'), '2');
                return { ok: true, json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/test' }) };
            }
            return emailFetch(url, options);
        };
        const checkout = await originalFetch(base + '/api/checkout/session', {
            method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: 1, quantity: 2, price: 0.01 }] })
        });
        assert.equal(checkout.status, 200);
        assert.equal((await checkout.json()).url, 'https://checkout.stripe.com/test');
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local';
        process.env.CHECKOUT_ENABLED = 'false';
        assert.equal((await request('/api/checkout/session', { items: [{ id: 1, quantity: 1 }] }, cookie)).status, 503);
        const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', payment_status: 'paid' } } });
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
            .update(`${timestamp}.${event}`).digest('hex');
        const webhook = await originalFetch(base + '/api/stripe/webhook', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: event
        });
        assert.equal(webhook.status, 200);
        const orders = await originalFetch(base + '/api/orders', { headers: { Cookie: cookie } });
        assert.equal((await orders.json()).orders[0].status, 'paid');
        assert.equal((await originalFetch(base + '/api/admin/dashboard', { headers: { Cookie: cookie } })).status, 403);
        assert.equal((await request('/api/auth/profile', { name:'Customer', email:'other@example.test' }, cookie)).status, 400);
        const ownerLogin = await request('/api/auth/signin', { email:process.env.ADMIN_EMAIL, password:process.env.ADMIN_PASSWORD });
        const owner = ownerLogin.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('/api/products/1', { name:'Updated item', price:15 }, owner, 'PATCH')).status, 200);
        assert.equal((await request('/api/products/1', { price:-2 }, owner, 'PATCH')).status, 400);
        assert.equal((await request('/api/newsletter/subscribe', {email:'reader@example.test'})).status, 200);
        const subscription = tokenFromLastEmail();
        assert.equal((await request('/api/newsletter/verify', {token:subscription})).status, 200);
        assert.equal((await request('/api/newsletter/unsubscribe', {email:'reader@example.test'})).status, 400);
        const newsletter = await request('/api/admin/newsletter', {subject:'News', message:'A new community update.'}, owner);
        assert.equal((await newsletter.json()).sent, 1);
        assert.match(emails.at(-1).html, /<a href="[^"]+\/profile\?unsubscribe=[^"]+"[^>]*>Unsubscribe<\/a>/);
        assert.ok(!emails.at(-1).html.includes('Unsubscribe:'));
        assert.ok(!emails.at(-1).html.includes('/profile.html')); 
        assert.equal((await request('/api/newsletter/unsubscribe', {token:tokenFromLastEmail()})).status, 200);
        await request('/api/auth/forgot-password', {email:'customer@example.test'});
        const reset = tokenFromLastEmail();
        assert.equal((await request('/api/auth/reset-password', {token:reset, password:''})).status, 400);
        assert.equal((await request('/api/auth/reset-password', {token:reset, password:'new'})).status, 200);
        assert.equal((await signin('new')).status, 200);
        assert.equal((await originalFetch(base + '/api/portal', {headers:{Cookie:cookie}})).status, 401);
        assert.equal((await request('/api/auth/reset-password', {token:reset, password:'new'})).status, 400);
        const backup = await (await originalFetch(base + '/api/owner/backup', {headers:{Cookie:owner}})).text();
        assert.equal((await request('/api/owner/backup/preview', {backup}, owner)).status, 200);
        assert.equal((await request('/api/owner/backup/restore', {backup}, owner)).status, 200);
        assert.equal((await originalFetch(base + '/api/admin/dashboard', {headers:{Cookie:owner}})).status, 403);
        const saved = JSON.parse(fs.readFileSync(process.env.DATA_PATH));
        assert.equal(saved.sessions.length, 0);
        assert.equal(saved.tokens.length, 0);
        assert.ok(saved.users[0].passwordHash && !saved.users[0].password);
        assert.equal((await originalFetch(base + '/api/support-requests', {method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'})).status,403);
        const stateBeforeOptIn = JSON.parse(fs.readFileSync(process.env.DATA_PATH));
        assert.equal(stateBeforeOptIn.subscribers.some(item => item.email === 'customer@example.test'), false);
        assert.equal((await request('/api/auth/register', {name:'Reader',email:'optin@example.test',password:'a-long-test-password',newsletterOptIn:true})).status, 201);
        const optInToken = tokenFromLastEmail();
        assert.equal(JSON.parse(fs.readFileSync(process.env.DATA_PATH)).subscribers.some(item => item.email === 'optin@example.test'), false);
        assert.equal((await request('/api/auth/verify', {token:optInToken})).status, 200);
        assert.ok(JSON.parse(fs.readFileSync(process.env.DATA_PATH)).subscribers.find(item => item.email === 'optin@example.test').verifiedAt);
        const previousBase = process.env.PUBLIC_BASE_URL;
        process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
        try {
            const localWrite = await originalFetch(base + '/api/auth/signout', {method:'POST',headers:{Origin:base}});
            assert.equal(localWrite.status, 200);
            assert.equal((await originalFetch(base + '/api/auth/signout', {method:'POST',headers:{Origin:'http://localhost:5500'}})).status, 403);
        } finally {
            if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
            else process.env.PUBLIC_BASE_URL = previousBase;
        }
        global.fetch = async (url, options) => String(url) === 'https://api.resend.com/emails' ? {ok:false,status:503} : originalFetch(url, options);
        const failed = await request('/api/auth/forgot-password', {email:'customer@example.test'});
        assert.equal(failed.status, 500);

    } finally {
        global.fetch = originalFetch;
        delete process.env.CHECKOUT_ENABLED;
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
