(function () {
    const state = { data: null, backupPreviewed: false, menuDraft: null, menuDirty: false };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const api = async (url, options = {}) => {
        const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers || {}) } });
        const data = await response.json();
        if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
        return data;
    };

    function renderOrders(filter = '') {
        const needle = filter.toLowerCase();
        document.getElementById('admin-orders').innerHTML = state.data.orders
            .filter(item => JSON.stringify(item).toLowerCase().includes(needle))
            .map(item => `<article class="admin-row" data-order="${esc(item.sessionId)}"><strong>${esc(item.email)}</strong><small>${esc(item.sessionId)}</small><select data-field="status">${['pending','paid','processing','shipped','completed','canceled'].map(status => `<option ${item.status===status?'selected':''}>${status}</option>`).join('')}</select><input data-field="progress" type="number" min="0" max="100" value="${Number(item.progress)||0}" aria-label="Progress"><textarea data-field="note" placeholder="Customer update">${esc(item.note)}</textarea><button class="white" data-save-order>Save order</button></article>`).join('') || '<p>No matching orders.</p>';
    }

    function renderRequests(filter = '') {
        const needle = filter.toLowerCase();
        document.getElementById('admin-requests').innerHTML = state.data.requests
            .filter(item => JSON.stringify(item).toLowerCase().includes(needle))
            .map(item => `<article class="admin-row" data-request="${esc(item.id)}"><strong>${esc(item.subject)}</strong><small>${esc(item.name)} · ${esc(item.email)}</small><p>${esc(item.message)}</p><select data-field="status">${['pending','confirmed','completed'].map(status => `<option ${item.status===status?'selected':''}>${status}</option>`).join('')}</select><textarea data-field="note" placeholder="Customer-visible update">${esc(item.note)}</textarea><div><button class="white" data-save-request>Save</button> <button class="white" data-delete-request>Delete</button></div></article>`).join('') || '<p>No matching requests.</p>';
    }

    function renderUsers(filter = '') {
        const needle = filter.toLowerCase();
        document.getElementById('admin-users').innerHTML = state.data.users
            .filter(item => JSON.stringify(item).toLowerCase().includes(needle))
            .map(item => `<article class="admin-row" data-user="${esc(item.id)}"><strong>${esc(item.name)}</strong><small>${esc(item.email)} · ${esc(item.role)} · ${item.verified?'verified':'unverified'}</small>${state.data.role==='owner' ? `<div><button class="white" ${item.verified?'':'disabled'} data-role="${item.role==='admin'?'user':'admin'}">${item.role==='admin'?'Remove admin':'Make admin'}</button> <button class="white" data-delete-user>Delete account</button></div>`:''}</article>`).join('') || '<p>No matching accounts.</p>';
    }

    function renderSubscribers(filter = '') {
        document.getElementById('admin-subscribers').innerHTML = state.data.subscribers.filter(item => item.email.toLowerCase().includes(filter.toLowerCase())).map(item => `<article class="admin-row" data-subscriber="${esc(item.id)}"><strong>${esc(item.email)}</strong><small>${item.verified?'verified':'awaiting verification'}</small><button class="white" data-remove-subscriber>Remove</button></article>`).join('') || '<p>No subscribers.</p>';
    }


    const navigationEditor = document.getElementById('navigation-editor');
    const navigationStatus = document.getElementById('navigation-status');
    function previewMenu() {
        const role = document.getElementById('navigation-preview-role').value;
        const signedIn = role !== 'guests';
        const admin = role === 'admins';
        const visible = (state.menuDraft || []).filter(item => menuItemVisible(item, signedIn, admin));
        document.getElementById('navigation-preview-list').innerHTML = visible.length ? visible.map(item => {
            const label = item.id === 'account' ? (signedIn ? 'Your portal' : 'Sign in') : item.label;
            return '<li>' + (item.presentation === 'icon' ? '<i class="fa-solid ' + esc(item.icon) + '" aria-hidden="true"></i> ' : '') + esc(label) + '</li>';
        }).join('') : '<li>No menu links for this audience.</li>';
    }
    function renderMenuEditor() {
        if (!navigationEditor || !state.menuDraft) return;
        navigationEditor.innerHTML = state.menuDraft.map((item, index) => `<div class="navigation-row" data-menu-id="${esc(item.id)}">
            <div class="navigation-item-name"><i class="fa-solid ${esc(item.icon)}" aria-hidden="true"></i><strong>${esc(item.label)}</strong></div>
            <label class="navigation-visible"><input type="checkbox" data-menu-field="visible" aria-label="Show ${esc(item.label)}" ${item.visible ? 'checked' : ''}> Visible</label>
            <label>Audience<select data-menu-field="audience" aria-label="Audience for ${esc(item.label)}" ${item.id === 'admin' ? 'disabled' : ''}>${[['everyone','Everyone'],['guests','Visitors only'],['members','Signed-in customers'],['admins','Administrators']].map(([value,label]) => '<option value="'+value+'" '+(item.audience===value?'selected':'')+'>'+label+'</option>').join('')}</select></label>
            <label>Display<select data-menu-field="presentation" aria-label="Display for ${esc(item.label)}"><option value="text" ${item.presentation==='text'?'selected':''}>Text</option><option value="icon" ${item.presentation==='icon'?'selected':''}>Icon</option></select></label>
            <div class="navigation-move"><button class="white" type="button" data-menu-move="-1" aria-label="Move ${esc(item.label)} up" ${index===0?'disabled':''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button><button class="white" type="button" data-menu-move="1" aria-label="Move ${esc(item.label)} down" ${index===state.menuDraft.length-1?'disabled':''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button></div>
        </div>`).join('');
        previewMenu();
    }
    function markMenuDirty() { state.menuDirty = true; navigationStatus.textContent = 'Unsaved menu changes'; previewMenu(); }
    navigationEditor.addEventListener('change', event => {
        const row = event.target.closest('[data-menu-id]');
        if (!row || !event.target.dataset.menuField) return;
        const item = state.menuDraft.find(item => item.id === row.dataset.menuId);
        const field = event.target.dataset.menuField;
        item[field] = field === 'visible' ? event.target.checked : event.target.value;
        markMenuDirty();
    });
    navigationEditor.addEventListener('click', event => {
        const button = event.target.closest('[data-menu-move]');
        if (!button) return;
        const row = button.closest('[data-menu-id]');
        const index = state.menuDraft.findIndex(item => item.id === row.dataset.menuId);
        const target = index + Number(button.dataset.menuMove);
        if (target < 0 || target >= state.menuDraft.length) return;
        [state.menuDraft[index], state.menuDraft[target]] = [state.menuDraft[target], state.menuDraft[index]];
        renderMenuEditor(); markMenuDirty();
        navigationEditor.querySelector('[data-menu-id="' + row.dataset.menuId + '"] [data-menu-move="' + button.dataset.menuMove + '"]')?.focus();
    });
    document.getElementById('navigation-preview-role').addEventListener('change', previewMenu);
    document.getElementById('navigation-reset').addEventListener('click', () => {
        state.menuDraft = structuredClone(state.data.navigationDefaults || DEFAULT_NAVIGATION);
        renderMenuEditor(); markMenuDirty();
    });
    document.getElementById('navigation-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = document.getElementById('navigation-save'); button.disabled = true;
        navigationStatus.textContent = 'Saving menu…';
        try {
            const data = await api('/api/admin/navigation', { method:'PUT', body: JSON.stringify({navigation:state.menuDraft}) });
            state.menuDraft = structuredClone(data.navigation); state.menuDirty = false;
            state.data.navigation = data.navigation;
            navigationSettings = data.navigation; updateAuthUI();
            navigationStatus.textContent = 'Menu saved. Changes apply across the website.';
            renderMenuEditor();
        } catch (error) { navigationStatus.textContent = error.message; }
        finally { button.disabled = false; }
    });

    async function load() {
        try {
            state.data = await api('/api/admin/dashboard');
            renderOrders(); renderRequests(); renderUsers(); renderSubscribers();
            if (!state.menuDirty) { state.menuDraft = structuredClone(state.data.navigation || DEFAULT_NAVIGATION); renderMenuEditor(); }
            document.getElementById('owner-tools').hidden = state.data.role !== 'owner';
            initScrollReveal();
        } catch (error) {
            if (error.status === 401) location.href = 'signin?redirect=admin';
            else if (error.status === 403) { const user = await api('/api/auth/me'); if (!user.user) location.href = 'signin?redirect=admin'; else document.getElementById('admin-panel').innerHTML = '<h2>Administrator access required</h2><p>This account cannot access the admin dashboard.</p><a href="portal">Return to your portal</a>'; }
            else showNotification(error.message);
        }
    }

    document.addEventListener('click', async event => {
        const order = event.target.closest('[data-order]');
        const request = event.target.closest('[data-request]');
        const user = event.target.closest('[data-user]');
        const subscriber = event.target.closest('[data-subscriber]');
        if (event.target.matches('[data-delete-request]') && !confirm('Delete this support request?')) return;
        if (event.target.matches('[data-role]') && !confirm('Change this account role and sign the user out?')) return;
        if (event.target.matches('[data-delete-user]') && !confirm('Delete this account and its associated data?')) return;
        if (event.target.matches('[data-remove-subscriber]') && !confirm('Remove this newsletter subscription?')) return;
        try {
            if (event.target.matches('[data-save-order]')) await api(`/api/admin/orders/${encodeURIComponent(order.dataset.order)}`, { method:'PATCH', body:JSON.stringify({ status:order.querySelector('[data-field=status]').value, progress:order.querySelector('[data-field=progress]').value, note:order.querySelector('[data-field=note]').value }) });
            if (event.target.matches('[data-save-request]')) await api(`/api/admin/requests/${request.dataset.request}`, { method:'PATCH', body:JSON.stringify({ status:request.querySelector('[data-field=status]').value, note:request.querySelector('[data-field=note]').value }) });
            if (event.target.matches('[data-delete-request]')) await api(`/api/admin/requests/${request.dataset.request}`, { method:'DELETE' });
            if (event.target.matches('[data-role]')) await api(`/api/owner/users/${user.dataset.user}/role`, { method:'PATCH', body:JSON.stringify({ role:event.target.dataset.role }) });
            if (event.target.matches('[data-delete-user]')) await api(`/api/owner/users/${user.dataset.user}`, { method:'DELETE' });
            if (event.target.matches('[data-remove-subscriber]')) await api(`/api/admin/subscribers/${subscriber.dataset.subscriber}`, { method:'DELETE' });
            if (event.target.matches('button') && (order || request || user || subscriber)) { showNotification('Saved.'); await load(); }
        } catch (error) { showNotification(error.message); }
    });

    document.getElementById('admin-subscriber-search').addEventListener('input', e => renderSubscribers(e.target.value));
    document.getElementById('backup-payload').addEventListener('input', () => { state.backupPreviewed = false; });
    document.getElementById('admin-order-search').addEventListener('input', e => renderOrders(e.target.value));
    document.getElementById('admin-request-search').addEventListener('input', e => renderRequests(e.target.value));
    document.getElementById('admin-user-search').addEventListener('input', e => renderUsers(e.target.value));
    document.getElementById('admin-newsletter-form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        button.disabled = true;
        try { const result = await api('/api/admin/newsletter', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(form))) }); showNotification(`Newsletter sent to ${result.sent}; ${result.failed} failed.`); form.reset(); }
        catch (error) { showNotification(error.message); }
        finally { button.disabled = false; }
    });
    document.getElementById('backup-preview').addEventListener('click', async () => {
        try { const result = await api('/api/owner/backup/preview', { method:'POST', body:JSON.stringify({backup:document.getElementById('backup-payload').value}) }); state.backupPreviewed = true; document.getElementById('backup-preview-output').textContent = JSON.stringify(result,null,2); }
        catch (error) { state.backupPreviewed=false; showNotification(error.message); }
    });
    document.getElementById('backup-restore').addEventListener('click', async () => {
        if (!state.backupPreviewed) return showNotification('Preview the backup first.');
        if (!confirm('Restore this backup? Current site data will be replaced and all users will be signed out.')) return;
        try { const result = await api('/api/owner/backup/restore', { method:'POST', body:JSON.stringify({backup:document.getElementById('backup-payload').value}) }); alert(result.message); location.href='signin'; }
        catch (error) { showNotification(error.message); }
    });
    load();
})();
