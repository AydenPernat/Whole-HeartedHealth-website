// Isolated store: menu tests never use local accounts or configured email services.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whh-navigation-'));
process.env.DATA_PATH = path.join(directory, 'data.json');
process.env.ADMIN_EMAIL = 'owner@example.test';
process.env.ADMIN_PASSWORD = 'test-password';
const customerToken = 'customer-fixture';
fs.writeFileSync(process.env.DATA_PATH, JSON.stringify({sessions:[{version:3,tokenHash:crypto.createHash('sha256').update(customerToken).digest('hex'),expiresAt:Date.now()+60000,user:{id:'customer',name:'Customer',email:'customer@example.test',role:'user'}}]}));
const app = require('./server');
test('menu settings validate audience and ordering, persist through other writes, and require administrator access', async () => {
 const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
 const get = async route => (await fetch(base+route)).json();
 const save = (navigation,cookie) => fetch(base+'/api/admin/navigation',{method:'PUT',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({navigation})});
 try {
  const defaults = (await get('/api/navigation')).navigation;
  assert.equal(defaults.length,10);
  assert.equal(defaults.find(item=>item.id==='admin').audience,'admins');
  assert.equal((await save(defaults)).status,403);
  assert.equal((await save(defaults,'whh_session='+customerToken)).status,403);
  const login = await fetch(base+'/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});
  const owner = login.headers.get('set-cookie').split(';')[0];
  const edited = structuredClone(defaults);
  edited.find(item=>item.id==='shop').visible=false;
  edited.find(item=>item.id==='events').audience='members';
  edited.find(item=>item.id==='contact').presentation='icon';
  const admin = edited.splice(edited.findIndex(item=>item.id==='admin'),1)[0]; edited.unshift(admin);
  assert.equal((await save(edited,owner)).status,200);
  assert.deepEqual((await get('/api/navigation')).navigation,edited);
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.DATA_PATH)).navigation,edited);
  // Signing in writes sessions; it must retain the saved menu rather than resetting it.
  await fetch(base+'/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});
  assert.deepEqual((await get('/api/navigation')).navigation,edited);
  const duplicate = structuredClone(edited); duplicate[1]=duplicate[0]; assert.equal((await save(duplicate,owner)).status,400);
  const publicAdmin = structuredClone(edited); publicAdmin[0].audience='everyone';assert.equal((await save(publicAdmin,owner)).status,400);
  const invalid = structuredClone(edited);invalid[1].presentation='script';assert.equal((await save(invalid,owner)).status,400);
  assert.deepEqual((await get('/api/navigation')).navigation,edited);
  const injected = structuredClone(edited);injected[0].url='https://example.test';assert.equal((await save(injected,owner)).status,200);
  assert.equal((await get('/api/navigation')).navigation[0].url,'admin');
  const dashboard=await (await fetch(base+'/api/admin/dashboard',{headers:{Cookie:owner}})).json();assert.deepEqual(dashboard.navigationDefaults,defaults);
 } finally {await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
});

