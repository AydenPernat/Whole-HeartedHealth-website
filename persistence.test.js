// Tests must never load local credentials or contact configured email services.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
let stored = { products: [], events: [], users: [], sessions: [], orders: [], subscribers: [], supportRequests: [], tokens: [] };
let failCommit = false;
let releases = 0;
class Pool {
    async query(sql) {
        if (sql.startsWith('SELECT data')) return { rowCount: 1, rows: [{ data: structuredClone(stored) }] };
        return { rows: [] };
    }
    async connect() {
        let pending = structuredClone(stored);
        return {
            query: async (sql, params) => {
                if (sql.startsWith('SELECT data')) return { rows: [{ data: structuredClone(stored) }] };
                if (sql.startsWith('UPDATE')) pending = JSON.parse(params[0]);
                if (sql === 'COMMIT') {
                    if (failCommit) throw new Error('Simulated database outage');
                    await new Promise(resolve => setTimeout(resolve, 15));
                    stored = pending;
                }
                return { rows: [] };
            },
            release: () => { releases++; }
        };
    }
}
require('pg');
require.cache[require.resolve('pg')].exports = { Pool };
process.env.DATABASE_URL = 'postgres://test';
process.env.ADMIN_EMAIL = '';
const app = require('./server');
test('PostgreSQL commits before acknowledgement, serializes writes, and reports failed commits', async () => {
    stored.sessions.push({ version:3, tokenHash:require('node:crypto').createHash('sha256').update('owner-fixture').digest('hex'), expiresAt:Date.now()+60000, user:{id:'owner',name:'Owner',email:'owner@example.test',role:'owner'} });
    await app.initializePersistence();
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const submit = subject => fetch(base + '/api/support-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({name:'Customer',email:'test@example.test',subject,message:'A test support request.'})
    });
    try {
        const responses = await Promise.all([submit('First'), submit('Second')]);
        assert.deepEqual(responses.map(response => response.status), [201, 201]);
        assert.deepEqual(stored.supportRequests.map(item => item.subject), ['First','Second']);
        failCommit = true;
        const failure = await submit('Must not persist');
        assert.equal(failure.status, 503);
        assert.match((await failure.json()).error, /could not be saved/);
        assert.equal(stored.supportRequests.length, 2);
        failCommit = false;
        assert.equal((await submit('Recovered')).status, 201);
        assert.deepEqual(stored.supportRequests.map(item => item.subject), ['First','Second','Recovered']);
        assert.equal(releases, 4);

        const owner = 'whh_session=owner-fixture';
        const menu = (await (await fetch(base + '/api/navigation')).json()).navigation;
        menu.find(item => item.id === 'shop').visible = false;
        const saveMenu = () => fetch(base + '/api/admin/navigation', { method:'PUT', headers:{'Content-Type':'application/json',Cookie:owner}, body:JSON.stringify({navigation:menu}) });
        assert.equal((await saveMenu()).status, 200);
        assert.equal(stored.navigation.find(item => item.id === 'shop').visible, false);
        failCommit = true;
        menu.find(item => item.id === 'shop').visible = true;
        assert.equal((await saveMenu()).status, 503);
        assert.equal(stored.navigation.find(item => item.id === 'shop').visible, false);
        failCommit = false;
        assert.equal((await (await fetch(base + '/api/navigation')).json()).navigation.find(item => item.id === 'shop').visible, false);
        assert.equal((await submit('Menu survives other writes')).status, 201);
        assert.equal(stored.navigation.find(item => item.id === 'shop').visible, false);

    } finally { await new Promise(resolve => server.close(resolve)); }
});
