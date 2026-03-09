const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e7 });

const DATA_DIR = path.join(__dirname, 'data'), FONTS_DIR = path.join(__dirname, 'fonts');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR);

const read = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f))); } 
    catch(e) { return f === 'users.json' ? [] : {}; }
};
const write = (f, d) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2));

const init = (f, d) => { if (!fs.existsSync(path.join(DATA_DIR, f))) write(f, d); };
init('users.json', []); init('rooms.json', {}); init('clans.json', {}); init('nek_docs.json', []);
init('items.json', []);
init('transactions.json', []);
init('sites.json', {});
init('zones.json', ['orm', 'omic', 'ogh']);
const DEFAULT_SITE_ZONES = ['ormolar', 'orm', 'omic', 'ogh'];

const ensureOrmolarInfra = () => {
    const sites = read('sites.json');
    if(!sites || Array.isArray(sites) || typeof sites !== 'object') write('sites.json', {});

    let zones = read('zones.json');
    if(!Array.isArray(zones)) zones = [];
    let changed = false;
    DEFAULT_SITE_ZONES.forEach((z) => {
        if(!zones.includes(z)) {
            zones.push(z);
            changed = true;
        }
    });
    if(changed) write('zones.json', zones);
};
ensureOrmolarInfra();

const BOT_NAME = "Нек";
const BOT_VOICE = "\u0413\u041e\u041b\u041e\u0421";
const HF_API_KEY = "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";
const HF_MODEL = "mistralai/Mistral-7B-Instruct-v0.2"; // Модель для генерации текста
const REWARD_SECRET = process.env.REWARD_SECRET || 'local_dev_reward_secret';

app.use('/fonts', express.static(FONTS_DIR));
app.use(express.static(__dirname));
app.use(express.json());

app.get(/^\/v([a-z0-9]+)s$/i, (req, res) => {
    ensureOrmolarInfra();
    const token = normalizeSiteToken(req.params[0]);
    const sites = read('sites.json');
    const site = sites[token];
    if(!site) return res.status(404).send('Site not found');
    return res.type('html').send(renderTeaPage(site));
});

app.get('/ormolar/index.json', (req, res) => {
    ensureOrmolarInfra();
    const q = String(req.query.q || '').toLowerCase().trim();
    const sites = Object.values(read('sites.json'));
    const filtered = q ? sites.filter(s => (s.fullDomain || '').includes(q) || (s.title || '').toLowerCase().includes(q) || (s.owner || '').toLowerCase().includes(q)) : sites;
    const out = filtered.slice(0, 500).map(s => ({
        domain: s.fullDomain,
        title: s.title || s.fullDomain,
        owner: s.owner,
        path: `v${s.token}s`,
        updatedAt: s.updatedAt
    }));
    res.json({ ok: true, count: out.length, sites: out });
});

app.get('/ormolar', (req, res) => res.redirect('/ormolar/index'));

app.get('/ormolar/index', (req, res) => {
    ensureOrmolarInfra();
    const q = String(req.query.q || '').toLowerCase().trim();
    const sites = Object.values(read('sites.json'));
    const filtered = q ? sites.filter(s => (s.fullDomain || '').includes(q) || (s.title || '').toLowerCase().includes(q) || (s.owner || '').toLowerCase().includes(q)) : sites;
    const rows = filtered.slice(0, 500).map(s => {
        const path = `v${s.token}s`;
        return `<details style="margin:10px 0; background:#161b22; border:1px solid #2b3240; border-radius:10px; padding:10px;"><summary style="cursor:pointer"><b>${escapeHtml(s.fullDomain)}</b> ? ${escapeHtml(s.title || '')} <small>by ${escapeHtml(s.owner || '')}</small></summary><div style="margin-top:10px"><iframe src="/${path}" style="width:100%; height:360px; border:1px solid #2b3240; border-radius:8px; background:#fff"></iframe><div style="margin-top:8px"><a href="/${path}" target="_blank">Open full page</a></div></div></details>`;
    }).join('');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ormolar Index</title><style>body{font-family:ui-sans-serif,system-ui;background:#0f1115;color:#e7ebf0;margin:0}main{max-width:980px;margin:0 auto;padding:24px}a{color:#80b8ff}input{width:100%;padding:10px;border-radius:8px;border:1px solid #2b3240;background:#161b22;color:#e7ebf0}details summary::-webkit-details-marker{display:none}</style></head><body><main><h1>Ormolar Index</h1><form method="get"><input name="q" value="${escapeHtml(q)}" placeholder="search domain/title/owner"></form>${rows || '<div style="opacity:.7;margin-top:10px">No pages</div>'}</main></body></html>`);
});


// Endpoint для внешних скриптов (например, bash) чтобы наградить пользователя ъмънами
app.post('/reward', (req, res) => {
    const { secret, username, amount, note } = req.body || {};
    if (secret !== REWARD_SECRET) return res.status(403).json({ error: 'forbidden' });
    const users = read('users.json');
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).json({ error: 'user_not_found' });
    const value = Number(amount || 0);
    users[idx].balance = (users[idx].balance || 0) + value;
    write('users.json', users);

    const txs = read('transactions.json');
    txs.push({ id: Date.now(), type: 'reward', to: username, amount: value, note: note || '', time: new Date().toISOString() });
    write('transactions.json', txs);

    io.emit('users_update');
    return res.json({ ok: true, balance: users[idx].balance });
});

const ADMIN_LOGIN = "Омикрун";
const ADMIN_PASS = "omicroon1326";

const generateToken = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const normalizeRoomToken = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if(!s) return '';
    const m = s.match(/v([a-z0-9]+)r/);
    return m ? m[1] : s.replace(/[^a-z0-9]/g, '');
};

const escapeHtml = (v) => String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeUrl = (u) => {
    const v = String(u || '').trim();
    if(/^https?:\/\//i.test(v)) return v;
    return '';
};

const normalizeSiteToken = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if(!s) return '';
    const m = s.match(/v([a-z0-9]+)s/);
    return m ? m[1] : s.replace(/[^a-z0-9]/g, '');
};

const parseDomainInput = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    const m = s.match(/^([a-z0-9-]{1,32})(?:\.([a-z0-9-]{2,16}))?$/);
    if(!m) return null;
    const name = m[1];
    const zone = m[2] || 'orm';
    return { name, zone, fullDomain: `${name}.${zone}` };
};

const compileTea = (tea) => {
    const lines = String(tea || '').split(/\r?\n/);
    const body = [];
    const fonts = [];
    let currentFont = '';
    let title = 'TEA Site';

    for(const line of lines) {
        const t = line.trim();
        if(!t) { body.push('<div style="height:8px"></div>'); continue; }
        if(/^title:/i.test(t)) { title = t.slice(6).trim() || title; continue; }
        if(/^font:/i.test(t)) {
            currentFont = t.slice(5).trim();
            if(currentFont && !fonts.includes(currentFont)) fonts.push(currentFont);
            continue;
        }

        const styledOpen = currentFont ? `<div style="font-family:${escapeHtml(currentFont)}">` : '';
        const styledClose = currentFont ? '</div>' : '';

        if(/^h1:/i.test(t)) body.push(`${styledOpen}<h1>${escapeHtml(t.slice(3).trim())}</h1>${styledClose}`);
        else if(/^h2:/i.test(t)) body.push(`${styledOpen}<h2>${escapeHtml(t.slice(3).trim())}</h2>${styledClose}`);
        else if(/^h3:/i.test(t)) body.push(`${styledOpen}<h3>${escapeHtml(t.slice(3).trim())}</h3>${styledClose}`);
        else if(/^img:/i.test(t)) {
            const u = safeUrl(t.slice(4).trim());
            if(u) body.push(`<img src="${u}" style="max-width:100%;border-radius:8px">`);
        }
        else if(/^link:/i.test(t)) {
            const rawLink = t.slice(5).trim();
            const parts = rawLink.split('|');
            const text = escapeHtml((parts[0] || '').trim() || 'link');
            const u = safeUrl((parts[1] || parts[0] || '').trim());
            if(u) body.push(`${styledOpen}<p><a href="${u}" target="_blank" rel="noopener">${text}</a></p>${styledClose}`);
        }
        else body.push(`${styledOpen}<p>${escapeHtml(t)}</p>${styledClose}`);
    }

    return { title, fonts, html: body.join('\n') };
};

const renderTeaPage = (site) => {
    let pageHtml = String(site.html || '');
    if(!/<[a-z][\s\S]*>/i.test(pageHtml) && site.teaCode) {
        // Backward compatibility: re-render old entries where TEA code was stored as plain text.
        pageHtml = compileTea(site.teaCode).html;
    }
    const fontPrefix = (site.fonts || []).map(f => `'${String(f).replace(/'/g, "")}'`).join(', ');
    const family = fontPrefix ? `${fontPrefix}, ui-sans-serif, system-ui` : 'ui-sans-serif, system-ui';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(site.title || site.fullDomain)}</title>
<style>body{margin:0;background:#111;color:#eee;font-family:${family}}main{max-width:960px;margin:0 auto;padding:24px}a{color:#7cb7ff}h1,h2,h3{margin:0 0 12px}p{line-height:1.55}small{opacity:.7}</style></head><body><main><small>${escapeHtml(site.fullDomain)} ? by ${escapeHtml(site.owner)}</small>${pageHtml}</main></body></html>`;
};

// Утилита для фильтрации комнат: публичные отдельно, ЛС отдельно
const getPublicRooms = (rooms, username, isAdmin) => {
    const pub = {};
    for(let k in rooms) {
        const room = rooms[k];
        if(room.isDm) continue;
        const roomAdmins = room.admins || [];
        if(room.isClosed && !(isAdmin || room.owner === username || roomAdmins.includes(username))) continue;
        const roomView = { ...room };
        if(roomView.token) delete roomView.token;
        pub[k] = roomView;
    }
    return pub;
};

const emitRoomsToSocket = (socket, rooms) => {
    const username = socket?.data?.username;
    const admin = !!socket?.data?.isAdmin;
    if(!username) return;
    socket.emit('update_rooms', getPublicRooms(rooms, username, admin));
};

const emitRoomsToAll = (rooms) => {
    io.sockets.sockets.forEach((s) => {
        emitRoomsToSocket(s, rooms);
    });
};

const getUserDMs = (rooms, username) => {
    const dms = {};
    for(let k in rooms) {
        if(rooms[k].isDm && rooms[k].participants.includes(username)) {
            dms[k] = rooms[k];
        }
    }
    return dms;
};

const getSelfClan = (username) => {
    const clans = read('clans.json');
    for (let id in clans) {
        const c = clans[id];
        if (c.members && c.members.includes(username)) {
            return { id, name: c.name, tag: c.tag, owner: c.owner, members: c.members };
        }
    }
    return null;
};

const getClansSummary = () => {
    const clans = read('clans.json');
    return Object.values(clans).map(c => ({
        id: c.id,
        name: c.name,
        tag: c.tag,
        membersCount: (c.members || []).length
    }));
};

// --- Бот Нек ---
const getDocs = () => {
    return read('nek_docs.json');
};

const addDoc = (title, content, author) => {
    const docs = getDocs();
    docs.push({
        id: Date.now(),
        title,
        content,
        author,
        createdAt: new Date().toISOString()
    });
    write('nek_docs.json', docs);
    return docs;
};

const getDocsContext = () => {
    const docs = getDocs();
    if(docs.length === 0) return "Документация пока пуста.";
    return docs.map(d => `[${d.title}] ${d.content}`).join('\n\n');
};

const getMessengerInfo = () => {
    return `VOY v4.0 Messenger - мессенджер для неографий (конструируемых письменностей).

Основные функции:
- Комнаты и личные сообщения
- Загрузка пользовательских шрифтов (PUA символы)
- НЕОГРАФИИ: добавление букв как картинок с автоматическим назначением PUA кодов
- Кланы: группы пользователей
- Команды: !факт(запрос), !запрет(слово), !админ(пользователь)
- Со-админы в комнатах
- Закрепление сообщений
- Поиск пользователей

Команды бота:
- "документация" или "доки" - показать документацию
- "добавить [название]: [содержание]" - добавить запись в документацию
- Любые вопросы о мессенджере - отвечу на основе документации и знаний о системе.`;
};

async function callHuggingFaceAPI(prompt, context = '') {
    try {
        const systemPrompt = `Ты Нек, бот-документалист мессенджера VOY v4.0. Твоя задача - помогать пользователям разобраться в функциях мессенджера и вести документацию.

${getMessengerInfo()}

Текущая документация:
${getDocsContext()}

Контекст чата: ${context}

Отвечай кратко и по делу на русском языке. Если вопрос не связан с мессенджером, вежливо скажи, что ты специализируешься на документации мессенджера.`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ];

        const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: messages.map(m => m.content).join('\n\n'),
                parameters: {
                    max_new_tokens: 200,
                    temperature: 0.7,
                    return_full_text: false
                }
            })
        });

        if (!response.ok) {
            // Если модель загружается, попробуем альтернативный подход
            if (response.status === 503) {
                console.log('Model is loading, using fallback response');
                return `Привет! Я Нек, бот-документалист. Сейчас модель загружается. Используйте команды: "документация" для просмотра документации или "добавить [название]: [содержание]" для добавления записи.`;
            }
            const errorText = await response.text();
            console.error('HF API Error:', response.status, errorText);
            return null;
        }

        const data = await response.json();
        let result = null;
        
        if (Array.isArray(data) && data.length > 0) {
            if (data[0].generated_text) {
                result = data[0].generated_text.trim();
            } else if (data[0].text) {
                result = data[0].text.trim();
            }
        } else if (data.generated_text) {
            result = data.generated_text.trim();
        } else if (data.text) {
            result = data.text.trim();
        }
        
        // Очистка ответа от лишних частей промпта
        if (result) {
            const lines = result.split('\n');
            result = lines[0].trim();
            if (result.length > 300) result = result.substring(0, 300) + '...';
        }
        
        return result;
    } catch (error) {
        console.error('HF API call failed:', error);
        return null;
    }
}

function shouldRespondToBot(text) {
    const lower = text.toLowerCase();
    return lower.includes('нек') || 
           lower.includes('бот') || 
           lower.startsWith('!нек') ||
           lower.includes('документация') ||
           lower.includes('доки') ||
           lower.includes('помощь');
}

function parseDocCommand(text) {
    const match = text.match(/добавить\s+([^:]+):\s*(.+)/i);
    if (match) {
        return { title: match[1].trim(), content: match[2].trim() };
    }
    return null;
}

io.on('connection', (socket) => {
    let me = null;
    let isAdmin = false;

    socket.on('register', (d) => {
        const u = read('users.json');
        if (u.find(x => x.username === d.username)) return socket.emit('error', 'Ник занят!');
        if (d.username === ADMIN_LOGIN || d.username === 'System') return socket.emit('error', 'Этот ник зарезервирован.');
        u.push({ username: d.username, password: d.password, bio: "", font: '', avatar: '', banned: false, clan: null, balance: 235, inventory: [] });
        write('users.json', u); socket.emit('alert', 'Готово! Войдите.');
    });

    socket.on('login', (d) => {
        if (d.username === ADMIN_LOGIN && d.password === ADMIN_PASS) {
            me = { username: ADMIN_LOGIN, font: '', avatar: '', bio: 'System Administrator', clan: null };
            isAdmin = true;
        } else {
            const users = read('users.json');
            const user = users.find(x => x.username === d.username && x.password === d.password);
            if (!user) return socket.emit('error', 'Ошибка входа');
            if (user.banned) return socket.emit('error', 'ВЫ ЗАБАНЕНЫ НАВСЕГДА.');
            if(typeof user.clan === 'undefined') user.clan = null;
            me = user; isAdmin = false;
        }

        socket.emit('auth_ok', { ...me, isAdmin });
        socket.data.username = me.username;
        socket.data.isAdmin = isAdmin;
        const rooms = read('rooms.json');
        emitRoomsToSocket(socket, rooms);
        socket.emit('update_dms', getUserDMs(rooms, me.username));
        socket.emit('clan_self', getSelfClan(me.username));
        socket.emit('clans_list', getClansSummary());
        socket.join('lobby'); // Для общих обновлений
    });

    // --- Rooms & DMs ---

    socket.on('create_room', (d) => {
        if(!me) return;
        const r = read('rooms.json'), id = 'room_' + Date.now();
        const isClosed = d.mode === 'closed';
        const token = isClosed ? generateToken() : null;
        r[id] = { 
            id, title: d.title, owner: me.username, 
            password: d.password || null, hasPass: !!d.password, 
            mode: d.mode, msgs: [], pinned: null, bannedWords: [],
            isDm: false, admins: [], isClosed, token
        };
        write('rooms.json', r); 
        emitRoomsToAll(r);
        if(isClosed) socket.emit('alert', 'Токен группы: v' + token + 'r');
    });

    socket.on('start_dm', (targetUser) => {
        if(!me) return;
        const rooms = read('rooms.json');
        // Ищем существующий ЛС
        const participants = [me.username, targetUser].sort();
        const dmId = `dm_${participants.join('_')}`;
        
        if(!rooms[dmId]) {
            rooms[dmId] = {
                id: dmId, title: targetUser, // Title меняется динамически на клиенте
                participants: participants,
                isDm: true, msgs: [], pinned: null, bannedWords: [],
                owner: 'system', // В ЛС нет владельца
                admins: []
            };
            write('rooms.json', rooms);
        }
        
        // Отправляем ID комнаты инициатору, чтобы он сразу вошел
        socket.emit('dm_ready', dmId);
        
        // Обновляем списки ЛС у обоих участников (если они онлайн)
        // В реальном продакшене лучше отправлять конкретным сокетам, тут через бродкаст с фильтром на клиенте или при следующем действии
        // Для простоты перешлем всем update_dms при следующем логине или можно форсировать:
        // (Упрощение: клиент сам обновит при входе, но для риалтайма можно использовать io.emit и фильтровать на сервере, но socket.io проще переслать списки)
    });
    
    // Принудительное обновление списков ЛС (костыль для простоты)
    socket.on('refresh_lists', () => {
        if(!me) return;
        const rooms = read('rooms.json');
        socket.emit('update_dms', getUserDMs(rooms, me.username));
        emitRoomsToSocket(socket, rooms);
    });

    socket.on('delete_room', (roomId) => {
        if(!me) return;
        const rooms = read('rooms.json');
        const r = rooms[roomId];
        if (r && (r.owner === me.username || isAdmin)) {
            delete rooms[roomId];
            write('rooms.json', rooms);
            emitRoomsToAll(rooms);
            io.to(roomId).emit('room_closed'); 
        }
    });

    socket.on('join_room', (d) => {
        const rooms = read('rooms.json');
        const r = rooms[d.id];
        if(!r) return;

        // Проверка прав для ЛС
        if(r.isDm && !isAdmin && !r.participants.includes(me.username)) {
            return socket.emit('error', 'Это приватный чат.');
        }

        // Проверка прав для приватных клановых чатов
        if(r.isClan && !isAdmin && !(r.participants || []).includes(me.username)) {
            return socket.emit('error', 'Доступ к чату клана доступен только участникам.');
        }

        const roomAdmins = r.admins || [];
        if(r.isClosed && !isAdmin && r.owner !== me.username && !roomAdmins.includes(me.username) && r.token && r.token !== normalizeRoomToken(d.token)) {
            return socket.emit('error', '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0442\u043e\u043a\u0435\u043d \u0433\u0440\u0443\u043f\u043f\u044b.');
        }

        if(!r.isDm && r.password && !isAdmin && r.owner !== me.username) {
            if(!r.isDm && r.password && !isAdmin) {
                if(!d.password || String(r.password) !== String(d.password)) return socket.emit('error', '???????? ??????!');
            }
        }
        
        socket.join(d.id);
        const data = {...r}; delete data.password; if(data.token) delete data.token;
        // Для ЛС меняем заголовок на имя собеседника
        if(r.isDm) {
            const other = r.participants.find(u => u !== me.username) || me.username;
            data.title = other;
        }
        socket.emit('room_history', data);
    });

    socket.on('join_by_token', (rawToken) => {
        if(!me) return;
        const token = normalizeRoomToken(rawToken);
        if(!token) return socket.emit('error', 'Неверный токен.');
        const rooms = read('rooms.json');
        const room = Object.values(rooms).find(x => x.isClosed && x.token === token);
        if(!room) return socket.emit('error', 'Закрытая комната по токену не найдена.');
        socket.emit('token_resolved', { id: room.id, token });
    });


    socket.on('list_sites', () => {
        ensureOrmolarInfra();
        if(!me) return;
        const sites = Object.values(read('sites.json'))
            .sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
            .slice(0, 500)
            .map(s => ({
                token: s.token,
                domain: s.fullDomain,
                title: s.title || s.fullDomain,
                owner: s.owner,
                path: `v${s.token}s`,
                url: `/v${s.token}s`,
                renderedHtml: renderTeaPage(s),
                updatedAt: s.updatedAt
            }));
        socket.emit('sites_list', sites);
    });

    socket.on('post_site', (payload) => {
        if(!me) return;
        ensureOrmolarInfra();
        const domainRaw = payload?.domain;
        const teaCode = String(payload?.teaCode || '').trim();
        const parsedDomain = parseDomainInput(domainRaw);
        if(!parsedDomain) return socket.emit('error', 'Invalid domain. Use name.zone or name');
        if(!teaCode) return socket.emit('error', 'TEA code is empty.');

        const zones = read('zones.json');
        if(!zones.includes(parsedDomain.zone)) {
            zones.push(parsedDomain.zone);
            write('zones.json', zones);
        }

        const sites = read('sites.json');
        let existingToken = null;
        for(const tk in sites) {
            if((sites[tk].fullDomain || '').toLowerCase() === parsedDomain.fullDomain) {
                existingToken = tk;
                break;
            }
        }

        if(existingToken && sites[existingToken].owner !== me.username && !isAdmin) {
            return socket.emit('error', 'Domain already owned by another user.');
        }

        let token = existingToken || generateToken();
        while(!existingToken && sites[token]) token = generateToken();

        const compiled = compileTea(teaCode);
        const now = new Date().toISOString();
        const prev = existingToken ? sites[existingToken] : null;
        sites[token] = {
            token,
            domain: parsedDomain.name,
            zone: parsedDomain.zone,
            fullDomain: parsedDomain.fullDomain,
            owner: prev?.owner || me.username,
            title: compiled.title || parsedDomain.fullDomain,
            teaCode,
            html: compiled.html,
            fonts: compiled.fonts,
            createdAt: prev?.createdAt || now,
            updatedAt: now
        };
        write('sites.json', sites);

        socket.emit('site_posted', {
            ok: true,
            token,
            path: `v${token}s`,
            url: `/v${token}s`,
            domain: parsedDomain.fullDomain
        });
    });

    socket.on('delete_site', (rawKey) => {
        if(!me) return;
        ensureOrmolarInfra();
        if(!isAdmin && me.username !== ADMIN_LOGIN) return socket.emit('error', 'Only Omikrun can delete sites.');
        const key = String(rawKey || '').trim().toLowerCase();
        if(!key) return socket.emit('error', 'Empty key.');

        const sites = read('sites.json');
        let token = normalizeSiteToken(key);
        if(!sites[token]) {
            token = Object.keys(sites).find(t => (sites[t].fullDomain || '').toLowerCase() === key || (sites[t].domain || '').toLowerCase() === key) || '';
        }
        if(!token || !sites[token]) return socket.emit('error', 'Site not found.');

        const domain = sites[token].fullDomain;
        delete sites[token];
        write('sites.json', sites);
        socket.emit('site_deleted', { ok: true, domain, token });
    });

    // --- Messaging & Commands ---

    socket.on('send_msg', (d) => {
        if(!me) return;
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(!r) return;

        // 1. Проверка на !запрет (Banned Words)
        if(d.type === 'text') {
            const badWord = r.bannedWords.find(w => d.text.toLowerCase().includes(w.toLowerCase()));
            if(badWord) return socket.emit('error', `Слово "${badWord}" запрещено в этом чате!`);
        }
        
        // 2. Обработка команд (начинаются с !)
        if(d.type === 'text' && d.text.startsWith('!')) {
            // !????? ? ???????? ????? ???????? ?????? (?????? ????????/?????)
            const tokenCmd = ['!token', '!\u0442\u043e\u043a\u0435\u043d'].includes(d.text.trim().toLowerCase());
            if(tokenCmd) {
                if(!r.isClosed) return socket.emit('error', '\u042d\u0442\u043e \u043d\u0435 \u0437\u0430\u043a\u0440\u044b\u0442\u0430\u044f \u0433\u0440\u0443\u043f\u043f\u0430.');
                if(r.owner !== me.username && !isAdmin) return socket.emit('error', '\u0422\u043e\u043b\u044c\u043a\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446 \u043c\u043e\u0436\u0435\u0442 \u0443\u0437\u043d\u0430\u0442\u044c \u0442\u043e\u043a\u0435\u043d.');
                socket.emit('alert', 'Токен группы: v' + (r.token || 'N/A') + 'r');
                return;
            }
            // !\u0433\u043e\u043b\u043e\u0441(\u0442\u0435\u043a\u0441\u0442) ? \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 \u0432\u0441\u0435\u043c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\u043c (\u0442\u043e\u043b\u044c\u043a\u043e \u041e\u043c\u0438\u043a\u0440\u0443\u043d/\u0430\u0434\u043c\u0438\u043d)
            const voiceMatch = d.text.match(/^!\u0433\u043e\u043b\u043e\u0441\((.+)\)$/i);
            if(voiceMatch) {
                if(!isAdmin && me.username !== ADMIN_LOGIN) return socket.emit('error', '\u0422\u043e\u043b\u044c\u043a\u043e \u041e\u043c\u0438\u043a\u0440\u0443\u043d \u043c\u043e\u0436\u0435\u0442 \u0434\u0435\u043b\u0430\u0442\u044c \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0443.');
                const text = (voiceMatch[1] || '').trim();
                if(!text) return;
                const allRooms = read('rooms.json');
                for(const id in allRooms) {
                    const room = allRooms[id];
                    const msg = createMsg(BOT_VOICE, null, text, 'text', room);
                    room.msgs.push(msg);
                    if(room.msgs.length > 200) room.msgs.shift();
                    io.to(room.id).emit('new_msg', msg);
                }
                write('rooms.json', allRooms);
                return;
            }


            // !запрет(слово)
            const banMatch = d.text.match(/^!запрет\((.+)\)$/);
            if(banMatch) {
                if(r.owner !== me.username && !isAdmin && !(r.admins || []).includes(me.username)) return socket.emit('error', 'Только владелец или со-админ может запрещать слова.');
                const word = banMatch[1].trim();
                r.bannedWords.push(word);
                write('rooms.json', rooms);
                
                // Системное сообщение о запрете
                const sysMsg = createMsg('System', null, `Слово "${word}" теперь запрещено.`, 'text', r);
                r.msgs.push(sysMsg);
                io.to(d.roomId).emit('new_msg', sysMsg);
                return; // Команда не публикуется как сообщение пользователя
            }

            // !админ(пользователь) — назначить со-админа в этом чате
            const coAdminMatch = d.text.match(/^!админ\((.+)\)$/);
            if(coAdminMatch) {
                if(r.isDm) return socket.emit('error', 'В личных сообщениях нет со-админов.');
                if(r.owner !== me.username && !isAdmin) return socket.emit('error', 'Только владелец комнаты или админ может назначать со-админов.');
                
                const targetName = coAdminMatch[1].trim();
                if(!targetName || targetName === r.owner) return;
                
                if(!r.admins) r.admins = [];
                if(!r.admins.includes(targetName)) {
                    r.admins.push(targetName);
                    write('rooms.json', rooms);

                    const sysMsg = createMsg('System', null, `Пользователь ${targetName} назначен со-админом этого чата.`, 'text', r);
                    r.msgs.push(sysMsg);
                    io.to(d.roomId).emit('new_msg', sysMsg);
                }
                return;
            }

            // !факт(текст)
            const factMatch = d.text.match(/^!факт\((.+)\)$/);
            if(factMatch) {
                const query = factMatch[1].trim();
                // Генерируем "карточку" поиска
                const searchLink = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                const wikiLink = `https://ru.wikipedia.org/wiki/${encodeURIComponent(query)}`;
                
                const sysMsg = createMsg('System', null, `
                    <b>🔍 Поисковый запрос:</b> ${query}<br>
                    <a href="${searchLink}" target="_blank" style="color:#3498db">👉 Найти в Google</a><br>
                    <a href="${wikiLink}" target="_blank" style="color:#3498db">📖 Читать в Википедии</a>
                `, 'text', r);
                
                r.msgs.push(sysMsg);
                write('rooms.json', rooms);
                io.to(d.roomId).emit('new_msg', sysMsg);
                return;
            }
        }

        // Стандартная отправка
        if (r.mode === 'channel' && r.owner !== me.username) {
            return socket.emit('error', '\u0412 \u043a\u0430\u043d\u0430\u043b\u0435 \u043f\u0438\u0441\u0430\u0442\u044c \u043c\u043e\u0436\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0430\u0432\u0442\u043e\u0440 \u043a\u0430\u043d\u0430\u043b\u0430.');
        }

        const m = createMsg(me.username, me.font, d.text, d.type, r, d.file, d.replyTo);
        
        r.msgs.push(m); 
        if(r.msgs.length > 200) r.msgs.shift();
        
        write('rooms.json', rooms); 
        io.to(d.roomId).emit('new_msg', m);
        
        // Обработка бота Нек
        if(d.type === 'text' && shouldRespondToBot(d.text) && me.username !== BOT_NAME) {
            setTimeout(async () => {
                const docCmd = parseDocCommand(d.text);
                if(docCmd) {
                    addDoc(docCmd.title, docCmd.content, me.username);
                    const botMsg = createMsg(BOT_NAME, null, `✅ Добавлена запись в документацию: "${docCmd.title}"`, 'text', r);
                    r.msgs.push(botMsg);
                    if(r.msgs.length > 200) r.msgs.shift();
                    write('rooms.json', rooms);
                    io.to(d.roomId).emit('new_msg', botMsg);
                } else if(d.text.toLowerCase().includes('документация') || d.text.toLowerCase().includes('доки')) {
                    const docs = getDocs();
                    if(docs.length === 0) {
                        const botMsg = createMsg(BOT_NAME, null, '📚 Документация пока пуста. Используйте команду "добавить [название]: [содержание]" для добавления записей.', 'text', r);
                        r.msgs.push(botMsg);
                        if(r.msgs.length > 200) r.msgs.shift();
                        write('rooms.json', rooms);
                        io.to(d.roomId).emit('new_msg', botMsg);
                    } else {
                        const docsList = docs.slice(-5).map(d => `• ${d.title}: ${d.content.substring(0, 100)}${d.content.length > 100 ? '...' : ''}`).join('\n');
                        const botMsg = createMsg(BOT_NAME, null, `📚 Последние записи документации:\n\n${docsList}\n\nВсего записей: ${docs.length}`, 'text', r);
                        r.msgs.push(botMsg);
                        if(r.msgs.length > 200) r.msgs.shift();
                        write('rooms.json', rooms);
                        io.to(d.roomId).emit('new_msg', botMsg);
                    }
                } else {
                    // Используем Hugging Face API для ответа
                    const recentMsgs = r.msgs.slice(-5).map(msg => `${msg.user}: ${msg.text}`).join('\n');
                    const hfResponse = await callHuggingFaceAPI(d.text, recentMsgs);
                    if(hfResponse) {
                        const botMsg = createMsg(BOT_NAME, null, hfResponse, 'text', r);
                        r.msgs.push(botMsg);
                        if(r.msgs.length > 200) r.msgs.shift();
                        write('rooms.json', rooms);
                        io.to(d.roomId).emit('new_msg', botMsg);
                    } else {
                        const botMsg = createMsg(BOT_NAME, null, 'Извините, сейчас не могу ответить. Попробуйте позже или используйте команды: "документация", "добавить [название]: [содержание]".', 'text', r);
                        r.msgs.push(botMsg);
                        if(r.msgs.length > 200) r.msgs.shift();
                        write('rooms.json', rooms);
                        io.to(d.roomId).emit('new_msg', botMsg);
                    }
                }
            }, 500);
        }
        
        // Если это ЛС, обновляем списки участников (чтобы чат поднялся наверх или появился)
        if(r.isDm) {
            r.participants.forEach(p => {
                // Это упрощение, в идеале отправлять конкретным сокетам
                // Но так как у нас нет маппинга юзер->сокет, полагаемся на refresh при входе или ручном обновлении
                // Для MVP: просто ничего не делаем, история обновится сама у тех кто внутри.
            });
        }
    });

    function createMsg(user, font, text, type, room, file = null, replyTo = null) {
        return {
            id: Date.now() + Math.random(), 
            user, userFont: font, text, type, file, 
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
            roomId: room.id,
            roomOwner: room.owner,
            roomAdmins: room.admins || [],
            replyTo
        };
    }

    socket.on('delete_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && (r.owner === me.username || isAdmin || (r.admins || []).includes(me.username) || r.isDm)) { // В ЛС любой может удалять (условно)
            r.msgs = r.msgs.filter(m => m.id != d.msgId);
            if(r.pinned && r.pinned.id == d.msgId) r.pinned = null;
            write('rooms.json', rooms); io.to(d.roomId).emit('msg_deleted', d.msgId);
            if(!r.pinned) io.to(d.roomId).emit('update_pin', null);
        }
    });

    socket.on('pin_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && (r.owner === me.username || isAdmin || (r.admins || []).includes(me.username))) {
            r.pinned = d.msgId ? r.msgs.find(m => m.id == d.msgId) : null;
            write('rooms.json', rooms); io.to(d.roomId).emit('update_pin', r.pinned);
        }
    });

    // --- Users & Admin ---

    socket.on('search_users', (query) => {
        if(!me) return;
        const all = read('users.json');
        const res = all.filter(u => u.username.toLowerCase().includes(query.toLowerCase())).map(u => ({ username: u.username, avatar: u.avatar }));
        socket.emit('search_results', res);
    });

    socket.on('get_other_profile', (username) => {
        if(!me) return;
        if(username === ADMIN_LOGIN) {
            socket.emit('show_other_profile', { username: ADMIN_LOGIN, bio: "System Administrator", avatar: "", isBanned: false });
            return;
        }
        const users = read('users.json');
        const target = users.find(u => u.username === username);
        if(target) {
            socket.emit('show_other_profile', { 
                username: target.username, 
                bio: target.bio, 
                avatar: target.avatar, 
                font: target.font,
                isBanned: target.banned 
            });
        }
    });

    socket.on('ban_user', (targetName) => {
        if(!isAdmin) return;
        if(targetName === ADMIN_LOGIN) return;
        const users = read('users.json');
        const idx = users.findIndex(u => u.username === targetName);
        if(idx !== -1) {
            users[idx].banned = true;
            write('users.json', users);
            io.emit('alert', `Пользователь ${targetName} был забанен администратором.`);
        }
    });

    socket.on('save_font_file', (d) => {
        if(!me || isAdmin) return;
        const name = `pua_${me.username}_${Date.now()}.ttf`, u = read('users.json');
        fs.writeFileSync(path.join(FONTS_DIR, name), Buffer.from(d.file.split(',')[1], 'base64'));
        const idx = u.findIndex(x => x.username === me.username);
        u[idx].font = `/fonts/${name}`; me = u[idx];
        write('users.json', u); socket.emit('auth_ok', me); io.emit('font_update', { user: me.username, font: me.font });
    });

    socket.on('update_profile', (d) => {
        if(!me) return;
        if(isAdmin) return;
        const u = read('users.json'), idx = u.findIndex(x => x.username === me.username);
        u[idx].bio = d.bio || u[idx].bio; u[idx].avatar = d.avatar || u[idx].avatar;
        write('users.json', u); me = u[idx]; socket.emit('auth_ok', me);
    });

    // --- Clans ---

    socket.on('get_clans', () => {
        if(!me) return;
        socket.emit('clan_self', getSelfClan(me.username));
        socket.emit('clans_list', getClansSummary());
    });

    // Запросы на вступление в клан (по заявке + доверенность)
    socket.on('get_clan_requests', () => {
        if(!me) return;
        const clans = read('clans.json');
        const current = Object.values(clans).find(c => (c.members || []).includes(me.username));
        if(!current) return socket.emit('clan_requests', []);
        socket.emit('clan_requests', current.joinRequests || []);
    });

    socket.on('request_join_clan', (clanId) => {
        if(!me) return;
        if(isAdmin) return socket.emit('error', 'Админ не может вступать в кланы.');
        if(getSelfClan(me.username)) return socket.emit('error', 'Вы уже состоите в клане.');
        const clans = read('clans.json');
        const c = clans[clanId];
        if(!c) return socket.emit('error', 'Клан не найден.');
        c.members = c.members || [];
        if(c.members.includes(me.username)) return socket.emit('error', 'Вы уже в клане.');
        c.joinRequests = c.joinRequests || [];
        if(c.joinRequests.find(r => r.user === me.username)) return socket.emit('error', 'Заявка уже отправлена.');
        c.joinRequests.push({ user: me.username, time: Date.now() });
        write('clans.json', clans);
        socket.emit('clan_request_ok', { clanId });
        io.emit('clan_requests_update', { clanId });
    });

    socket.on('approve_join_clan', ({ clanId, username }) => {
        if(!me) return;
        const clans = read('clans.json');
        const c = clans[clanId];
        if(!c) return socket.emit('error', 'Клан не найден.');
        c.members = c.members || [];
        if(!c.members.includes(me.username)) return socket.emit('error', 'Недостаточно прав.');
        c.joinRequests = c.joinRequests || [];
        const reqIdx = c.joinRequests.findIndex(r => r.user === username);
        if(reqIdx === -1) return socket.emit('error', 'Заявка не найдена.');

        const users = read('users.json');
        const uidx = users.findIndex(u => u.username === username);
        if(uidx === -1) {
            c.joinRequests.splice(reqIdx, 1);
            write('clans.json', clans);
            return socket.emit('error', 'Пользователь не найден.');
        }
        if(users[uidx].clan && users[uidx].clan !== clanId) return socket.emit('error', 'Пользователь уже в другом клане.');

        if(!c.members.includes(username)) c.members.push(username);
        c.joinRequests.splice(reqIdx, 1);
        write('clans.json', clans);

        users[uidx].clan = clanId;
        write('users.json', users);

        const rooms = read('rooms.json');
        const clanRoomId = 'clanroom_' + clanId;
        if(rooms[clanRoomId]) {
            rooms[clanRoomId].participants = rooms[clanRoomId].participants || [];
            if(!rooms[clanRoomId].participants.includes(username)) rooms[clanRoomId].participants.push(username);
            write('rooms.json', rooms);
        }

        io.emit('clan_refresh', { clanId });
    });

    socket.on('reject_join_clan', ({ clanId, username }) => {
        if(!me) return;
        const clans = read('clans.json');
        const c = clans[clanId];
        if(!c) return socket.emit('error', 'Клан не найден.');
        c.members = c.members || [];
        if(!c.members.includes(me.username)) return socket.emit('error', 'Недостаточно прав.');
        c.joinRequests = c.joinRequests || [];
        const before = c.joinRequests.length;
        c.joinRequests = c.joinRequests.filter(r => r.user !== username);
        if(c.joinRequests.length !== before) write('clans.json', clans);
        io.emit('clan_requests_update', { clanId });
    });

    // Лидерборд кланов — сортировка по количеству участников, затем по сумме балансов участников
    socket.on('get_clan_leaderboard', () => {
        if(!me) return;
        const clans = read('clans.json');
        const users = read('users.json');
        const list = Object.values(clans).map(c => {
            const members = c.members || [];
            const membersCount = members.length;
            const totalBalance = members.reduce((s, m) => {
                const u = users.find(x => x.username === m);
                return s + ((u && Number(u.balance)) || 0);
            }, 0);
            return { id: c.id, name: c.name, tag: c.tag, membersCount, totalBalance };
        });
        list.sort((a,b) => { if(b.membersCount !== a.membersCount) return b.membersCount - a.membersCount; return b.totalBalance - a.totalBalance; });
        socket.emit('clan_leaderboard', list);
    });

    // Подглядеть одно сообщение из чата другого клана за фиксированную плату (не сообщаем целевому клану)
    socket.on('peek_clan_message', ({ clanId, msgId }) => {
        if(!me) return;
        const CLAN_PEEK_PRICE = 780;
        const users = read('users.json');
        const uidx = users.findIndex(u => u.username === me.username);
        if(uidx === -1) return socket.emit('error', 'Пользователь не найден');
        if((users[uidx].balance || 0) < CLAN_PEEK_PRICE) return socket.emit('error', 'Недостаточно ъмънов');

        const clans = read('clans.json');
        if(!clans[clanId]) return socket.emit('error', 'Клан не найден');

        const rooms = read('rooms.json');
        const clanRoomId = 'clanroom_' + clanId;
        const room = rooms[clanRoomId];
        if(!room) return socket.emit('error', 'Чат клана не найден');

        // Находим сообщение: если передали msgId — ищем, иначе берём случайное
        let msg = null;
        if(msgId) msg = (room.msgs || []).find(m => String(m.id) === String(msgId));
        if(!msg) {
            const possible = room.msgs || [];
            if(possible.length === 0) return socket.emit('error', 'В чате нет сообщений');
            msg = possible[Math.floor(Math.random()*possible.length)];
        }

        // Списываем плату
        users[uidx].balance = (users[uidx].balance || 0) - CLAN_PEEK_PRICE;
        write('users.json', users);

        const txs = read('transactions.json');
        txs.push({ id: Date.now(), type: 'peek', by: me.username, clan: clanId, messageId: msg.id, amount: CLAN_PEEK_PRICE, time: new Date().toISOString() });
        write('transactions.json', txs);

        // Возвращаем сообщение только запрашивающему; не уведомляем целевой клан
        socket.emit('peek_result', { ok: true, message: msg });
        io.emit('users_update');
    });

    socket.on('create_clan', (d) => {
        if(!me) return;
        if(isAdmin) return socket.emit('error', 'Админ не может создавать кланы.');
        const name = (d.name || '').trim();
        const tag = (d.tag || '').trim();
        if(!name) return socket.emit('error', 'Введите название клана.');
        const clans = read('clans.json');
        if(getSelfClan(me.username)) return socket.emit('error', 'Сначала выйдите из текущего клана.');
        for(let id in clans) {
            if(clans[id].name.toLowerCase() === name.toLowerCase()) return socket.emit('error', 'Клан с таким названием уже есть.');
            if(tag && clans[id].tag && clans[id].tag.toLowerCase() === tag.toLowerCase()) return socket.emit('error', 'Клан с таким тегом уже есть.');
        }
        const id = 'clan_' + Date.now();
        clans[id] = { id, name, tag, owner: me.username, members: [me.username], joinRequests: [], createdAt: Date.now() };
        write('clans.json', clans);

        // Создаём приватный чат для клана
        const rooms = read('rooms.json');
        const clanRoomId = 'clanroom_' + id;
        rooms[clanRoomId] = {
            id: clanRoomId,
            title: `Клан: ${name}`,
            owner: me.username,
            password: null,
            hasPass: false,
            mode: 'clan',
            msgs: [],
            pinned: null,
            bannedWords: [],
            isDm: false,
            isClan: true,
            clanId: id,
            participants: [me.username],
            admins: []
        };
        write('rooms.json', rooms);

        // обновляем пользователя
        const users = read('users.json');
        const idx = users.findIndex(u => u.username === me.username);
        if(idx !== -1) {
            users[idx].clan = id;
            write('users.json', users);
            me = users[idx];
        }

        socket.emit('clan_self', getSelfClan(me.username));
        io.emit('clans_list', getClansSummary());
    });

    socket.on('join_clan', (clanId) => {
        if(!me) return;
        return socket.emit('error', 'Вступление в клан только по заявке и доверенности.');
    });

    socket.on('leave_clan', () => {
        if(!me) return;
        const current = getSelfClan(me.username);
        if(!current) return;
        const clans = read('clans.json');
        const c = clans[current.id];
        if(!c) return;
        c.members = (c.members || []).filter(u => u !== me.username);
        if(c.members.length === 0) {
            delete clans[current.id];
        } else {
            if(c.owner === me.username) {
                c.owner = c.members[0]; // передаём владельца первому оставшемуся
            }
        }
        write('clans.json', clans);

        const users = read('users.json');
        const idx = users.findIndex(u => u.username === me.username);
        if(idx !== -1) {
            users[idx].clan = null;
            write('users.json', users);
            me = users[idx];
        }

        // Удаляем участника из приватного чата клана
        const rooms = read('rooms.json');
        const clanRoomId = 'clanroom_' + current.id;
        if(rooms[clanRoomId]) {
            rooms[clanRoomId].participants = (rooms[clanRoomId].participants || []).filter(u => u !== me.username);
            // Если клан удалён (members length === 0), удалим и комнату
            if(!clans[current.id]) delete rooms[clanRoomId];
            write('rooms.json', rooms);
        }

        socket.emit('clan_self', getSelfClan(me.username));
        io.emit('clans_list', getClansSummary());
    });

    // --- Marketplace & Currency ---

    socket.on('get_balance', () => {
        if(!me) return;
        socket.emit('balance', { balance: me.balance || 0 });
    });

    socket.on('list_items', () => {
        const items = read('items.json');
        socket.emit('items_list', items || []);
    });

    socket.on('create_item', (d) => {
        if(!me) return;
        const items = read('items.json');
        const id = 'item_' + Date.now();
        const newItem = { id, owner: me.username, title: (d.title||'').toString(), price: Number(d.price||0), description: d.description || '', createdAt: new Date().toISOString() };
        items.push(newItem); write('items.json', items);
        io.emit('items_list', items);
        socket.emit('create_item_ok', newItem);
    });

    socket.on('buy_item', (itemId) => {
        if(!me) return;
        const items = read('items.json');
        const item = items.find(i => i.id === itemId);
        if(!item) return socket.emit('error', 'Товар не найден');

        const users = read('users.json');
        const buyerIdx = users.findIndex(u => u.username === me.username);
        if(buyerIdx === -1) return socket.emit('error', 'Пользователь не найден');

        const buyer = users[buyerIdx];
        if((buyer.balance || 0) < item.price) return socket.emit('error', 'Недостаточно ъмънов');

        buyer.balance = (buyer.balance || 0) - item.price;
        buyer.inventory = buyer.inventory || [];
        buyer.inventory.push({ itemId: item.id, title: item.title, from: item.owner, purchasedAt: new Date().toISOString() });

        const sellerIdx = users.findIndex(u => u.username === item.owner);
        if(sellerIdx !== -1) users[sellerIdx].balance = (users[sellerIdx].balance || 0) + item.price;

        write('users.json', users);

        const txs = read('transactions.json');
        txs.push({ id: Date.now(), type: 'purchase', itemId: item.id, itemTitle: item.title, from: item.owner, to: buyer.username, amount: item.price, time: new Date().toISOString() });
        write('transactions.json', txs);

        me = users[buyerIdx];
        socket.emit('purchase_ok', { item, balance: me.balance });
        io.emit('users_update');
    });
});

server.listen(3000, () => console.log('VOY v4.0 Messenger Update running on 3000'));
