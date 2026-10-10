process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = require('./server');

test('public pages, linked assets, and legacy redirects remain reachable', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const assets = new Set(['/style.css', '/script.js', '/admin-dashboard.js']);
    try {
        const pages = fs.readdirSync(__dirname).filter(file => file.endsWith('.html'));
        for (const file of pages) {
            const response = await fetch(`${base}/${file}`);
            assert.equal(response.status, 200, file);
            const html = await response.text();
            if (file === 'events.html') assert.match(html, /id="events-grid"/, 'Events page must render its own event collection.');
            assert.equal((html.match(/<main\b/g) || []).length, 1, `${file}: one main landmark`);
            assert.equal((html.match(/<\/main>/g) || []).length, 1, `${file}: closed main landmark`);
            for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1], { filename: file });
            for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
                const ref = match[1];
                if (/^(https?:|tel:|mailto:|\/api\/|\$\{)/.test(ref)) continue;
                const url = new URL(ref, `${base}/${file}`);
                assets.add(url.pathname);
            }
        }
        const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
        for (const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) {
            if (!match[1].startsWith('http')) assets.add(new URL(match[1], base).pathname);
        }
        for (const asset of assets) assert.equal((await fetch(base + asset)).status, 200, asset);
        for (const [from, to] of Object.entries({ 'portal.html?newsletter_verify=keep-token':'profile.html?newsletter_verify=keep-token', 'portal.html':'profile.html', 'blog.html':'events.html', 'track.html':'portal.html', 'event-nutrition-qa-night.html':'events.html', 'event-spring-wellness-workshop.html':'events.html', 'event-summer-product-preview.html':'events.html' })) {
            const response = await fetch(`${base}/${from}`, { redirect: 'manual' });
            assert.equal(response.status, 301, from);
            assert.equal(response.headers.get('location'), '/' + to);
        }
        for (const file of ['server.js', '.env', 'data.json', 'render.yaml', 'sample-data.archived.json']) assert.equal((await fetch(`${base}/${file}`)).status, 404, file);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('post-login redirects retain valid destinations and reject external, missing, or looping destinations', () => {
    const html = fs.readFileSync(path.join(__dirname, 'signin.html'), 'utf8');
    const start = html.indexOf('const allowedDestinations');
    const end = html.indexOf('const redirect =', start);
    const context = vm.createContext({ URL, location: { origin: 'https://example.test', href: 'https://example.test/signin.html' } });
    vm.runInContext(html.slice(start, end), context);
    for (const [input, expected] of [
        ['wishlist.html','/wishlist.html'], ['/sproduct.html?id=123','/sproduct.html?id=123'],
        ['track.html','/portal.html'], ['blog.html','/events.html'],
        ['https://evil.test','profile.html'], ['//evil.test','profile.html'],
        ['javascript:alert(1)','profile.html'], ['missing.html','profile.html'],
        ['signin.html','profile.html'], ['/api/owner/backup','profile.html']
    ]) assert.equal(context.getSignInDestination(input), expected, input);
});
