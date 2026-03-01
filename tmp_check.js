
    const socket = io();
    let me = null, curRoom = null, replyTo = null, viewingUser = null;
    let neoLetters = [];
    let favoriteRooms = {};
    let latestRooms = {};
    let latestDms = {};
    let neoStorageKey = null;
    let clansList = [];
    let myClan = null;
    let clanRequests = [];

    // --- Helpers ---
    function registerUserFont(username, fontPath) {
        if(!fontPath || document.getElementById(`style-${username}`)) return;
        const style = document.createElement('style');
        style.id = `style-${username}`;
        // Пользовательский шрифт используется как fallback для "своих символов",
        // а основной текст везде остаётся на глобальном шрифте сервиса.
        style.innerHTML = `@font-face { font-family: 'font_${username}'; src: url('${fontPath}?v=${Date.now()}'); font-display: swap; } .u-font-${username} { font-family: var(--global-font), 'font_${username}'; }`;
        document.head.appendChild(style);
    }
    const toBase64 = f => new Promise((res, rej) => { const r = new FileReader(); r.readAsDataURL(f); r.onload = () => res(r.result); r.onerror = e => rej(e); });
    function show(id) { 
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); 
        const screen = document.getElementById(id);
        if(screen) screen.classList.add('active');
        if(id === 'scr-clans') {
            socket.emit('get_clans');
            loadClanLeaderboard();
            loadClanRequests();
        }
    }

    function applyTheme(theme) {
        const t = theme === 'light' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', t);
        localStorage.setItem('voy_theme', t);
        const sel = document.getElementById('theme-select');
        if(sel) sel.value = t;
    }
    function onThemeChange() {
        const sel = document.getElementById('theme-select');
        if(sel) applyTheme(sel.value);
    }


    function getFavoritesKey() {
        return me ? `voy_favorites_${me.username}` : 'voy_favorites_guest';
    }

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(getFavoritesKey());
            const parsed = raw ? JSON.parse(raw) : {};
            favoriteRooms = (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            favoriteRooms = {};
        }
    }

    function saveFavorites() {
        localStorage.setItem(getFavoritesKey(), JSON.stringify(favoriteRooms));
    }

    function isFavoriteRoom(roomId) {
        return !!favoriteRooms[roomId];
    }

    function toggleFavoriteRoom(entry, e) {
        if(e) e.stopPropagation();
        if(!entry || !entry.id) return;
        if(isFavoriteRoom(entry.id)) {
            delete favoriteRooms[entry.id];
        } else {
            favoriteRooms[entry.id] = {
                id: entry.id,
                source: entry.source || 'rooms',
                title: entry.title || 'Untitled',
                mode: entry.mode || 'chat',
                hasPass: !!entry.hasPass
            };
        }
        saveFavorites();
        renderFavorites();
    }

    function favoriteBtn(roomId, payload) {
        const active = isFavoriteRoom(roomId);
        const bg = active ? '#1f8b4d' : '#27ae60';
        const title = active ? 'Remove from favorites' : 'Add to favorites';
        return `<button class="btn-small" title="${title}" style="float:right; margin-left:6px; background:${bg}" onclick='toggleFavoriteRoom(${JSON.stringify(payload)}, event)'>&#128220;</button>`;
    }

    function openFavoriteRoom(entry) {
        if(!entry || !entry.id) return;
        const pass = entry.hasPass ? prompt('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u043e\u0442 \u043a\u043e\u043c\u043d\u0430\u0442\u044b:') : null;
        curRoom = entry.id;
        socket.emit('join_room', { id: entry.id, password: pass });
    }

    function renderFavorites() {
        const list = document.getElementById('list-favorites');
        if(!list) return;
        const items = [];
        for(const id in favoriteRooms) {
            if(latestRooms[id]) {
                const r = latestRooms[id];
                favoriteRooms[id] = { id: r.id, source: 'rooms', title: r.title, mode: r.mode, hasPass: !!r.hasPass };
                items.push(favoriteRooms[id]);
            } else if(latestDms[id]) {
                const dm = latestDms[id];
                const other = dm.participants.find(u => u !== me.username) || me.username;
                favoriteRooms[id] = { id: dm.id, source: 'dms', title: other, mode: 'dm', hasPass: false };
                items.push(favoriteRooms[id]);
            }
        }

        if(!items.length) {
            list.innerHTML = '<div style="color:var(--muted); text-align:center; padding:20px">Пока нет избранных чатов</div>';
            saveFavorites();
            return;
        }

        list.innerHTML = '';
        items.forEach(item => {
            const d = document.createElement('div');
            d.style = 'padding:12px; margin-bottom:5px; background:var(--panel-3); border-radius:6px; position:relative;';
            const icon = item.mode === 'channel' ? '&#128226;' : (item.mode === 'dm' ? '&#128172;' : '#');
            d.innerHTML = `<div><b>${icon} ${item.title}</b>${favoriteBtn(item.id, item)}</div><div style="font-size:0.8em; opacity:0.7">${item.source === 'dms' ? '\u041b\u0438\u0447\u043d\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f' : '\u041a\u043e\u043c\u043d\u0430\u0442\u0430'}</div>`;
            d.onclick = (e) => {
                if(e.target.tagName === 'BUTTON') return;
                openFavoriteRoom(item);
            };
            list.appendChild(d);
        });
        saveFavorites();
    }


    // --- Auth ---

    // --- Auth ---
    function auth(type) {
        const u = document.getElementById('au-u').value, p = document.getElementById('au-p').value;
        if(u && p) socket.emit(type, { username: u, password: p });
    }

    socket.on('auth_ok', user => {
        me = user;
        localStorage.setItem('voy_u', user.username);
        if(!user.isAdmin) localStorage.setItem('voy_p', document.getElementById('au-p').value);
        
        document.getElementById('my-nick-disp').innerText = me.username;
        document.getElementById('my-ava-mini').src = me.avatar || '';
        document.getElementById('admin-tag').style.display = me.isAdmin ? 'inline-block' : 'none';
        
        if(me.font) registerUserFont(me.username, me.font);

        neoStorageKey = 'voy_neo_' + me.username;
        loadFavorites();
        renderFavorites();
        loadNeoLetters();
        renderNeoLetters();
        socket.emit('get_clans');
        socket.emit('get_balance');
        show('scr-lobby');
    });

    // --- Lobby & Tabs ---
    function switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active-tab', t.dataset.tab === tab));
        document.querySelectorAll('.list-section').forEach(l => l.classList.remove('active-list'));
        if(tab === 'rooms') {
            document.getElementById('list-rooms').classList.add('active-list');
        } else if(tab === 'dms') {
            document.getElementById('list-dms').classList.add('active-list');
        } else {
            renderFavorites();
            document.getElementById('list-favorites').classList.add('active-list');
        }
    }

    socket.on('update_rooms', rooms => {
        latestRooms = rooms || {};
        const l = document.getElementById('list-rooms'); l.innerHTML = '';
        Object.values(latestRooms).forEach(r => {
            const d = document.createElement('div');
            d.style = "padding:12px; margin-bottom:5px; background:var(--panel-3); border-radius:6px; position:relative";
            let delBtn = (me && (me.username === r.owner || me.isAdmin)) ? `<button class="btn-danger btn-small" style="float:right; margin-left:10px" onclick="deleteRoom('${r.id}', event)">&#128465;</button>` : '';
            const favBtn = favoriteBtn(r.id, { id: r.id, source: 'rooms', title: r.title, mode: r.mode, hasPass: !!r.hasPass });
            const icon = r.mode === 'channel' ? '&#128226;' : (r.mode === 'group' ? '&#128274;' : '#');
            const lockMark = (r.hasPass || r.isClosed) ? ' &#128274;' : '';
            d.innerHTML = `<div><b>${icon} ${r.title}</b>${lockMark} ${favBtn} ${delBtn}</div>
                           <div style="font-size:0.8em; opacity:0.6">Создатель: ${r.owner}</div>`;
            d.onclick = (e) => {
                if(e.target.tagName === 'BUTTON') return;
                let pass = r.hasPass ? prompt('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u043e\u0442 \u043a\u043e\u043c\u043d\u0430\u0442\u044b:') : null;
                let token = r.isClosed ? prompt('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u043e\u043a\u0435\u043d \u0433\u0440\u0443\u043f\u043f\u044b:') : null;
                curRoom = r.id; socket.emit('join_room', { id: r.id, password: pass, token: token });
            };
            l.appendChild(d);
        });
        renderFavorites();
    });

socket.on('update_dms', dms => {
        latestDms = dms || {};
        const l = document.getElementById('list-dms'); l.innerHTML = '';
        const list = Object.values(latestDms);
        if(list.length === 0) l.innerHTML = '<div style="color:var(--muted); text-align:center; padding:20px">Нет личных сообщений</div>';
        list.forEach(r => {
            const other = r.participants.find(u => u !== me.username) || me.username;
            const d = document.createElement('div');
            d.className = 'user-card';
            const favBtn = favoriteBtn(r.id, { id: r.id, source: 'dms', title: other, mode: 'dm', hasPass: false });
            d.innerHTML = `<b>&#128172; ${other}</b>${favBtn}`;
            d.onclick = (e) => {
                if(e.target.tagName === 'BUTTON') return;
                curRoom = r.id; socket.emit('join_room', { id: r.id });
            };
            l.appendChild(d);
        });
        renderFavorites();
    });

    // --- Clans ---    // --- Clans ---
    function renderMyClan() {
        const emptyBox = document.getElementById('clan-self-empty');
        const infoBox = document.getElementById('clan-self-info');
        const titleEl = document.getElementById('clan-self-title');
        const ownerEl = document.getElementById('clan-self-owner');
        const membersEl = document.getElementById('clan-self-members');
        if(!emptyBox || !infoBox) return;
        if(!myClan) {
            emptyBox.style.display = 'block';
            infoBox.style.display = 'none';
            renderClanRequests();
            return;
        }
        emptyBox.style.display = 'none';
        infoBox.style.display = 'block';
        const tagPart = myClan.tag ? ` [${myClan.tag}]` : '';
        titleEl.innerText = `Клан: ${myClan.name}${tagPart}`;
        ownerEl.innerText = `Владелец: ${myClan.owner}`;
        const members = myClan.members || [];
        membersEl.innerHTML = members.length 
            ? `Участники: ${members.join(', ')}`
            : 'Участников пока нет.';
        renderClanRequests();
    }

    function renderClanRequests() {
        const box = document.getElementById('clan-requests-box');
        const listEl = document.getElementById('clan-requests-list');
        if(!box || !listEl) return;
        listEl.innerHTML = '';
        if(!myClan || !clanRequests || clanRequests.length === 0) {
            box.style.display = 'none';
            return;
        }
        box.style.display = 'block';
        clanRequests.forEach(r => {
            const row = document.createElement('div');
            row.style = 'padding:8px; background:var(--panel-3); border-radius:6px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;';
            const left = document.createElement('div');
            const name = document.createElement('b');
            name.innerText = r.user || 'Unknown';
            const meta = document.createElement('div');
            meta.style = 'font-size:0.8em; opacity:0.7;';
            meta.innerText = r.time ? new Date(r.time).toLocaleString() : '';
            left.appendChild(name);
            left.appendChild(meta);

            const actions = document.createElement('div');
            actions.style = 'display:flex; gap:6px;';
            const ok = document.createElement('button');
            ok.className = 'btn-small';
            ok.innerText = 'Одобрить';
            ok.onclick = () => approveClanJoin(r.user);
            const no = document.createElement('button');
            no.className = 'btn-small btn-danger';
            no.innerText = 'Отклонить';
            no.onclick = () => rejectClanJoin(r.user);
            actions.appendChild(ok);
            actions.appendChild(no);

            row.appendChild(left);
            row.appendChild(actions);
            listEl.appendChild(row);
        });
    }

    function renderClansList() {
        const box = document.getElementById('clan-list');
        if(!box) return;
        box.innerHTML = '';
        if(!clansList || !clansList.length) {
            box.innerHTML = '<div style="color:var(--muted); text-align:center; padding:8px;">Кланов пока нет.</div>';
            return;
        }
        clansList.forEach(c => {
            const d = document.createElement('div');
            d.style = 'padding:8px 10px; border-radius:6px; background:var(--panel-3); margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:6px;';
            const tagPart = c.tag ? ` [${c.tag}]` : '';
            const canRequest = !myClan;
            d.innerHTML = `
                <div>
                    <div><b>${c.name}${tagPart}</b></div>
                    <div style="font-size:0.8em; opacity:0.7;">Участников: ${c.membersCount}</div>
                </div>
                ${canRequest ? `<button class="btn-small" onclick="requestJoinClan('${c.id}')">Подать заявку</button>` : '<button class="btn-small" disabled>Недоступно</button>'}
            `;
            box.appendChild(d);
        });
    }

    function createClan() {
        const nameEl = document.getElementById('clan-new-name');
        const tagEl = document.getElementById('clan-new-tag');
        const name = (nameEl.value || '').trim();
        const tagRaw = (tagEl.value || '').trim();
        const tag = tagRaw ? tagRaw.substring(0, 6) : '';
        if(!name) { alert('Введите название клана.'); return; }
        socket.emit('create_clan', { name, tag });
    }

    function requestJoinClan(id) {
        if(!id) return;
        socket.emit('request_join_clan', id);
    }

    function loadClanRequests() {
        socket.emit('get_clan_requests');
    }
    function approveClanJoin(username) {
        if(!myClan || !username) return;
        socket.emit('approve_join_clan', { clanId: myClan.id, username });
    }
    function rejectClanJoin(username) {
        if(!myClan || !username) return;
        socket.emit('reject_join_clan', { clanId: myClan.id, username });
    }

    function leaveClan() {
        if(confirm('Покинуть клан?')) socket.emit('leave_clan');
    }

    socket.on('clan_self', data => {
        myClan = data;
        renderMyClan();
        renderClansList();
        loadClanRequests();
    });

    socket.on('clan_requests', list => {
        clanRequests = list || [];
        renderClanRequests();
    });

    socket.on('clan_request_ok', () => {
        alert('Заявка отправлена. Дождитесь доверенности от участника клана.');
    });

    socket.on('clan_requests_update', () => {
        loadClanRequests();
    });

    socket.on('clan_refresh', () => {
        if(me) socket.emit('get_clans');
        loadClanRequests();
        loadClanLeaderboard();
    });

    socket.on('clans_list', list => {
        clansList = list || [];
        renderClansList();
    });

    // Clan leaderboard
    function loadClanLeaderboard() { socket.emit('get_clan_leaderboard'); }
    socket.on('clan_leaderboard', list => {
        const el = document.getElementById('clan-leaderboard');
        if(!el) return;
        const rows = Array.isArray(list) ? list : [];
        el.innerHTML = rows.length 
            ? rows.map((c, i) => `\n<div style="padding:8px; background:var(--panel-3); border-radius:6px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;"><div><b>${i+1}. ${c.name}${c.tag?(' ['+c.tag+']') : ''}</b><div style="font-size:0.85em; opacity:0.8">Участников: ${c.membersCount} • Всего ъмънов: ${c.totalBalance}</div></div><div><button class=\"btn-small\" onclick=\"peekClanPrompt('${c.id}')\">Подглядеть (780)</button></div></div>`).join('')
            : '<div style="color:var(--muted); padding:8px">Пока пусто</div>';
    });

    function openMyClanChat() {
        if(!myClan) return alert('Вы не в клане');
        const roomId = 'clanroom_' + myClan.id; curRoom = roomId; socket.emit('join_room', { id: roomId });
    }

    function peekClanPrompt(clanId) {
        if(!confirm('Заплатить 780 Ъмън и увидеть одно сообщение из указанного клана?')) return;
        socket.emit('peek_clan_message', { clanId });
    }

    socket.on('peek_result', d => {
        if(d && d.ok && d.message) {
            alert('Сообщение:\n' + d.message.user + ': ' + d.message.text);
            socket.emit('get_balance');
        } else if(d && d.error) alert(d.error);
    });


    socket.on('users_update', () => {
        if(me) socket.emit('get_balance');
    });

    socket.on('balance', b => {
        const val = (b && b.balance) || b || 0;
        document.getElementById('my-balance').innerText = val;
        if(me) me.balance = val;
    });

    // Shop
    function openShop() { socket.emit('list_items'); show('scr-shop'); }

    socket.on('items_list', items => {
        const box = document.getElementById('shop-list'); box.innerHTML = '';
        (items||[]).forEach(it => {
            const d = document.createElement('div'); d.style = 'padding:10px; background:var(--panel-3); margin-bottom:8px; border-radius:6px;';
            d.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><div><b>${it.title}</b><div style="font-size:0.85em; opacity:0.8">${it.description||''}</div></div><div style="text-align:right"><div style="font-weight:bold">${it.price} Ъмън</div><button onclick="buyItem('${it.id}')">Купить</button></div></div>`;
            box.appendChild(d);
        });
    });

    function createItem() {
        const t = document.getElementById('item-title').value; const p = Number(document.getElementById('item-price').value||0);
        const desc = document.getElementById('item-desc').value;
        if(!t || isNaN(p)) return alert('Введите название и корректную цену');
        socket.emit('create_item', { title: t, price: p, description: desc });
        document.getElementById('item-title').value = ''; document.getElementById('item-price').value = ''; document.getElementById('item-desc').value = '';
        socket.emit('list_items');
    }

    function buyItem(id) { if(!confirm('Купить товар?')) return; socket.emit('buy_item', id); }

    socket.on('purchase_ok', d => {
        alert('Покупка успешна! Баланс: ' + (d.balance||0));
        document.getElementById('my-balance').innerText = d.balance||0;
    });


    socket.on('room_closed', () => { alert('Комната удалена.'); show('scr-lobby'); curRoom = null; });
    function createRoom() {
        const t = document.getElementById('new-room-title').value;
        const p = document.getElementById('new-room-pass').value;
        const m = document.getElementById('new-room-mode').value;
        if(t) socket.emit('create_room', { title: t, password: p, mode: m });
    }
    function deleteRoom(id, e) { e.stopPropagation(); if(confirm('Удалить?')) socket.emit('delete_room', id); }

    // --- Chat ---
    socket.on('room_history', r => {
        document.getElementById('chat-title').innerText = r.title;
        document.getElementById('msgs-cont').innerHTML = '';
        cancelReply();
        r.msgs.forEach(addMsg);
        updatePinUI(r.pinned);
        show('scr-chat');
    });

    // Starting DM from profile
    function startDM() {
        if(!viewingUser) return;
        socket.emit('start_dm', viewingUser);
    }
    socket.on('dm_ready', (roomId) => {
        curRoom = roomId;
        socket.emit('join_room', { id: roomId });
    });

    function startReply(id, txt, user) {
        replyTo = { id, txt, user };
        document.getElementById('reply-ui').style.display = 'flex';
        document.getElementById('reply-target-text').innerText = `Ответ ${user}: ${txt.substring(0, 20)}...`;
        document.getElementById('m-in').focus();
    }
    function cancelReply() { replyTo = null; document.getElementById('reply-ui').style.display = 'none'; }

    function sendMsg() {
        const txt = document.getElementById('m-in').value;
        if(txt) { 
            socket.emit('send_msg', { roomId: curRoom, text: txt, type: 'text', replyTo: replyTo }); 
            document.getElementById('m-in').value = ''; 
            cancelReply();
        }
    }
    async function sendFile() {
        const f = document.getElementById('f-upl').files[0];
        if(!f || !curRoom) return;
        const b64 = await toBase64(f);
        socket.emit('send_msg', { roomId: curRoom, file: b64, type: f.type.startsWith('image') ? 'img' : 'file', text: f.name });
    }

    socket.on('new_msg', addMsg);
    socket.on('msg_deleted', id => { const e = document.getElementById(`m-${id}`); if(e) e.remove(); });
    socket.on('update_pin', msg => updatePinUI(msg));

    function addMsg(m) {
        if(m.userFont) registerUserFont(m.user, m.userFont);
        const c = document.getElementById('msgs-cont');
        const d = document.createElement('div');
        d.id = `m-${m.id}`;
        
        const isSys = m.user === 'System';
        d.className = `msg ${m.user === me.username ? 'my' : ''} ${isSys ? 'sys' : ''}`;
        
        let content = m.text;
        if(m.type === 'img') content = `<img src="${m.file}">`;
        if(m.type === 'file') content = `<a href="${m.file}" download="${m.text}">📄 ${m.text}</a>`;
        if(!isSys && m.type === 'text') {
            const hasPUA = /[\uE000-\uF8FF]/.test(m.text);
            const safeText = m.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            const safeTextWithBreaks = safeText.replace(/\n/g, '<br>');
            if(hasPUA) {
                // Для PUA делаем текст крупнее и не мешаем глобальный шрифт
                content = `<span class="u-font-${m.user}" style="font-size:1.3em; line-height:1.3;">${safeTextWithBreaks}</span>`;
            } else {
                content = `<span style="font-family: var(--global-font);">${safeTextWithBreaks}</span>`;
            }
        }

        let replyHtml = '';
        if (m.replyTo) replyHtml = `<div class="reply-ctx" onclick="document.getElementById('m-${m.replyTo.id}')?.scrollIntoView({behavior:'smooth', block:'center'})"><b>${m.replyTo.user}:</b> ${m.replyTo.txt.substring(0,30)}</div>`;

        let adminTools = '';
        // В ЛС нет pinned, но есть delete
        const roomAdmins = m.roomAdmins || [];
        const canManage = (me.username === m.roomOwner || roomAdmins.includes(me.username) || me.isAdmin) && !isSys;
        if(canManage) {
            adminTools = `<button class="btn-small btn-danger" onclick="delMsg('${m.id}')">&#128465;</button> 
                          <button class="btn-small" onclick="pinMsg('${m.id}')">Pin</button>`;
        }
        
        const userDisplay = isSys ? `<b>SYSTEM</b>` : `<span onclick="viewProfile('${m.user}')" style="cursor:pointer; font-weight:bold">${m.user}</span>`;

        d.innerHTML = `${replyHtml}
                       <div style="font-size:0.7em; opacity:0.6; display:flex; justify-content:space-between">
                           ${userDisplay} <span>${m.time}</span>
                       </div>
                       ${content}
                       ${!isSys ? `<div class="msg-tools"><button class="btn-small" onclick="startReply('${m.id}', '${m.type==='text'?m.text:'[File]'}', '${m.user}')">↩</button>${adminTools}</div>` : ''}`;
        
        c.appendChild(d); c.scrollTop = c.scrollHeight;
    }

    function delMsg(id) { socket.emit('delete_msg', { roomId: curRoom, msgId: id }); }
    function pinMsg(id) { socket.emit('pin_msg', { roomId: curRoom, msgId: id }); }
    function unpin() { socket.emit('pin_msg', { roomId: curRoom, msgId: null }); }
    function updatePinUI(msg) {
        const bar = document.getElementById('pinned-msg');
        if(msg) {
            bar.style.display = 'flex'; 
            document.getElementById('pin-text').innerText = "📌 " + (msg.type === 'text' ? msg.text : "Файл/Фото");
            document.getElementById('unpin-ui').style.display = (me.username === msg.roomOwner || me.isAdmin) ? 'block' : 'none';
        } else { bar.style.display = 'none'; }
    }

    // --- Search & Profiles ---
    function searchUsers() { const q = document.getElementById('search-in').value; if(q) socket.emit('search_users', q); }
    function searchChannels() {
        const q = (document.getElementById('search-ch-in').value || '').toLowerCase().trim();
        const box = document.getElementById('search-ch-res');
        if(!box) return;
        box.innerHTML = '';
        const rooms = Object.values(latestRooms || {}).filter(r => r.mode === 'channel');
        const filtered = q ? rooms.filter(r => (r.title || '').toLowerCase().includes(q)) : rooms;
        if(filtered.length === 0) {
            box.innerHTML = '<div style="color:var(--muted); padding:5px">Каналы не найдены</div>';
            return;
        }
        filtered.forEach(r => {
            const d = document.createElement('div');
            d.className = 'user-card';
            const lock = r.hasPass ? ' &#128274;' : '';
            d.innerHTML = `<b>&#128226; ${r.title}</b>${lock}`;
            d.onclick = () => {
                let pass = r.hasPass ? prompt('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u043e\u0442 \u043a\u043e\u043c\u043d\u0430\u0442\u044b:') : null;
                curRoom = r.id; socket.emit('join_room', { id: r.id, password: pass });
            };
            box.appendChild(d);
        });
    }

    socket.on('search_results', res => {
        const c = document.getElementById('search-res'); c.innerHTML = '';
        res.forEach(u => {
            const d = document.createElement('div'); d.className = 'user-card';
            d.innerHTML = `<img src="${u.avatar||''}" style="width:24px;height:24px;border-radius:50%;background:var(--ava-bg)"> <b>${u.username}</b>`;
            d.onclick = () => viewProfile(u.username);
            c.appendChild(d);
        });
        if(res.length===0) c.innerHTML='<div style="padding:5px;color:var(--muted)">Пусто</div>';
    });

    function viewProfile(name) {
        if(name === me.username) return show('scr-profile');
        if(name === 'System') return;
        viewingUser = name;
        socket.emit('get_other_profile', name);
    }
    socket.on('show_other_profile', p => {
        document.getElementById('oth-nick').innerText = p.username;
        document.getElementById('oth-bio').innerText = p.bio || "Нет информации.";
        document.getElementById('oth-ava').src = p.avatar || '';
        document.getElementById('oth-font-info').innerText = p.font ? "Шрифт: Пользовательский" : "Шрифт: Стандартный";
        const adm = document.getElementById('admin-controls');
        if (me.isAdmin && p.username !== 'Омикрун') {
            adm.style.display = 'block';
            adm.innerHTML = p.isBanned ? '<b style="color:red">ПОЛЬЗОВАТЕЛЬ ЗАБАНЕН</b>' : '<h3 style="color:var(--danger)">Admin Zone</h3><button onclick="banCurrentViewedUser()" class="btn-danger">ЗАБАНИТЬ ПОЛЬЗОВАТЕЛЯ</button>';
        } else { adm.style.display = 'none'; }
        show('scr-other');
    });
    function banCurrentViewedUser() { if(viewingUser && confirm(`ЗАБАНИТЬ ${viewingUser}?`)) { socket.emit('ban_user', viewingUser); show('scr-lobby'); } }

    // --- My Profile ---
    async function uploadFont() { 
        const f = document.getElementById('p-font-upl').files[0]; 
        if(f) socket.emit('save_font_file', { file: await toBase64(f) }); 
    }
    async function saveProfile() { const bio = document.getElementById('p-bio').value, avaSrc = document.getElementById('p-ava-view').src; socket.emit('update_profile', { bio, avatar: avaSrc.startsWith('data:') ? avaSrc : null }); }
    function previewAva() { toBase64(document.getElementById('p-ava-file').files[0]).then(r => document.getElementById('p-ava-view').src = r); }
    function logout() { 
        localStorage.clear(); 
        document.body.className = document.body.className
            .split(' ')
            .filter(c => !c.startsWith('u-font-'))
            .join(' ');
        me = null;
        neoLetters = [];
        neoStorageKey = null;
        location.reload(); 
    }
    
    // --- PUA ---
    function togglePUA() { 
        const g = document.getElementById('pua-grid'); 
        if(g.style.display !== 'grid') {
            // каждый раз перед открытием перерисовываем, чтобы были актуальные НЕО‑буквы
            g.innerHTML = '';
            if(neoLetters && neoLetters.length) {
                neoLetters.forEach((item, idx) => {
                    const code = item.code || (0xE000 + idx);
                    const ch = String.fromCodePoint(code);
                    const hex = code.toString(16).toUpperCase();
                    const b = document.createElement('div');
                    b.className = 'pua-key';
                    const label = item.label ? item.label : '';
                    const imgPart = item.img 
                        ? `<img src="${item.img}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:3px;">` 
                        : `<span class="u-font-${me ? me.username : ''}" style="font-size:1.2em;">${ch}</span>`;
                    b.innerHTML = imgPart;
                    b.title = label ? `${label} (U+${hex})` : `U+${hex}`;
                    b.onclick = () => {
                        const inp = document.getElementById('m-in');
                        if(inp) inp.value += ch;
                    };
                    g.appendChild(b);
                });
            } else {
                // fallback: старые 60 PUA-символов подряд, если НЕО‑букв ещё нет
                for(let i=0; i<60; i++) {
                    const char = String.fromCharCode(0xE000 + i);
                    const b = document.createElement('div');
                    b.className = `pua-key u-font-${me ? me.username : ''}`;
                    b.innerText = char;
                    b.title = `U+${(0xE000 + i).toString(16).toUpperCase()}`;
                    b.onclick = () => {
                        const inp = document.getElementById('m-in');
                        if(inp) inp.value += char;
                    };
                    g.appendChild(b);
                }
            }
            g.style.display = 'grid';
        } else {
            g.style.display = 'none';
        }
    }

    socket.on('error', m => alert(m));
    socket.on('alert', m => alert(m));

    // Глобальное обновление шрифтов пользователей
    socket.on('font_update', ({ user, font }) => {
        registerUserFont(user, font);
    });

    // --- НЕОГРАФИИ (локальное хранилище символов PUA) ---
    function loadNeoLetters() {
        if(!neoStorageKey) return;
        try {
            const raw = localStorage.getItem(neoStorageKey);
            const arr = raw ? JSON.parse(raw) : [];
            // Миграция со старого формата {char, label} к новому {code, label, img}
            neoLetters = arr.map((item, idx) => {
                if(typeof item.code === 'number') return item;
                if(item.char) {
                    return {
                        code: item.char.codePointAt(0),
                        label: item.label || '',
                        img: null
                    };
                }
                return {
                    code: 0xE000 + idx,
                    label: item.label || '',
                    img: null
                };
            });
        } catch(e) {
            neoLetters = [];
        }
    }
    function saveNeoLetters() {
        if(!neoStorageKey) return;
        localStorage.setItem(neoStorageKey, JSON.stringify(neoLetters));
    }
    function renderNeoLetters() {
        const cont = document.getElementById('neo-list');
        if(!cont) return;
        cont.innerHTML = '';
        if(!neoLetters.length) {
            cont.innerHTML = '<div style="color:var(--muted); text-align:center; padding:10px;">Нет добавленных букв. Загрузите картинку и нажмите «Добавить букву».</div>';
            return;
        }
        neoLetters.forEach((item, idx) => {
            const d = document.createElement('div');
            d.style = 'display:flex; align-items:center; justify-content:space-between; background:var(--panel-3); padding:8px 10px; border-radius:6px; margin-bottom:6px; gap:10px;';
            const label = item.label ? item.label : 'Без названия';
            const hex = (item.code || (0xE000 + idx)).toString(16).toUpperCase();
            d.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    ${item.img ? `<img src="${item.img}" style="width:40px;height:40px;border-radius:4px;object-fit:contain;background:var(--panel-4);">` : ''}
                    <div>
                        <div><b>${label}</b></div>
                        <div style="font-size:0.8em; opacity:0.7;">PUA: U+${hex}</div>
                    </div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn-small" onclick="copyNeoLetter(${idx})">Копировать</button>
                    <button class="btn-small btn-danger" onclick="deleteNeoLetter(${idx})">✕</button>
                </div>
            `;
            cont.appendChild(d);
        });
    }
    async function addNeoLetter() {
        const fileInput = document.getElementById('neo-img');
        const lbIn = document.getElementById('neo-label');
        if(!fileInput || !lbIn) return;
        const file = fileInput.files[0];
        const lb = (lbIn.value || '').trim();
        if(!file) { alert('Загрузите картинку буквы.'); return; }

        // Генерация следующего PUA‑кода
        const used = neoLetters
            .map(i => i.code)
            .filter(c => typeof c === 'number')
            .sort((a,b) => a-b);
        const base = 0xE000;
        let next = base;
        if(used.length) next = used[used.length - 1] + 1;

        const imgData = await toBase64(file);
        neoLetters.push({ code: next, label: lb, img: imgData });
        fileInput.value = '';
        lbIn.value = '';
        saveNeoLetters();
        renderNeoLetters();
    }
    function deleteNeoLetter(idx) {
        if(idx < 0 || idx >= neoLetters.length) return;
        neoLetters.splice(idx, 1);
        saveNeoLetters();
        renderNeoLetters();
    }
    function copyNeoLetter(idx) {
        if(idx < 0 || idx >= neoLetters.length) return;
        const item = neoLetters[idx];
        const hex = (item.code || (0xE000 + idx)).toString(16).toUpperCase();
        const text = `U+${hex}`;
        if(navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                alert('PUA‑код скопирован в буфер обмена.');
            }).catch(() => {
                prompt('Скопируйте код вручную:', text);
            });
        } else {
            prompt('Скопируйте код вручную:', text);
        }
    }

    window.onload = () => {
        applyTheme(localStorage.getItem('voy_theme') || 'dark');
        const u = localStorage.getItem('voy_u'), p = localStorage.getItem('voy_p');
        if(u && p) { document.getElementById('au-u').value = u; document.getElementById('au-p').value = p; auth('login'); }
    }
