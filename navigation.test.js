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
            assert.equal(new URL(response.url).pathname, '/' + file.slice(0, -5));
            const redirectResponse = await fetch(base + '/' + file + '?keep=value', {redirect:'manual'});
            assert.equal(redirectResponse.status, 301);
            assert.equal(redirectResponse.headers.get('location'), '/' + file.slice(0, -5) + '?keep=value');
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
        for (const [from, to] of Object.entries({ 'portal.html?newsletter_verify=keep-token':'profile?newsletter_verify=keep-token', 'portal.html':'profile', 'blog.html':'events', 'track.html':'profile', 'event-nutrition-qa-night.html':'events', 'event-spring-wellness-workshop.html':'events', 'event-summer-product-preview.html':'events' })) {
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
        ['wishlist.html','/wishlist'], ['wishlist','/wishlist'], ['/sproduct.html?id=123','/sproduct?id=123'], ['/sproduct?id=123','/sproduct?id=123'],
        ['track.html','/profile'], ['blog.html','/events'],
        ['https://evil.test','profile'], ['//evil.test','profile'],
        ['javascript:alert(1)','profile'], ['missing.html','profile'],
        ['signin.html','profile'], ['/api/owner/backup','profile']
    ]) assert.equal(context.getSignInDestination(input), expected, input);
});
