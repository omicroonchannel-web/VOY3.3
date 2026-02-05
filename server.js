const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

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
init('users.json', []); init('rooms.json', {});

app.use('/fonts', express.static(FONTS_DIR));
app.use(express.static(__dirname));

const ADMIN_LOGIN = "Омикрун";
const ADMIN_PASS = "omicroon1326";

// Утилита для фильтрации комнат: публичные отдельно, ЛС отдельно
const getPublicRooms = (rooms) => {
    const pub = {};
    for(let k in rooms) if(!rooms[k].isDm) pub[k] = rooms[k];
    return pub;
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

io.on('connection', (socket) => {
    let me = null;
    let isAdmin = false;

    socket.on('register', (d) => {
        const u = read('users.json');
        if (u.find(x => x.username === d.username)) return socket.emit('error', 'Ник занят!');
        if (d.username === ADMIN_LOGIN || d.username === 'System') return socket.emit('error', 'Этот ник зарезервирован.');
        u.push({ username: d.username, password: d.password, bio: "", font: '', avatar: '', banned: false });
        write('users.json', u); socket.emit('alert', 'Готово! Войдите.');
    });

    socket.on('login', (d) => {
        if (d.username === ADMIN_LOGIN && d.password === ADMIN_PASS) {
            me = { username: ADMIN_LOGIN, font: '', avatar: '', bio: 'System Administrator' };
            isAdmin = true;
        } else {
            const users = read('users.json');
            const user = users.find(x => x.username === d.username && x.password === d.password);
            if (!user) return socket.emit('error', 'Ошибка входа');
            if (user.banned) return socket.emit('error', 'ВЫ ЗАБАНЕНЫ НАВСЕГДА.');
            me = user; isAdmin = false;
        }

        socket.emit('auth_ok', { ...me, isAdmin });
        const rooms = read('rooms.json');
        socket.emit('update_rooms', getPublicRooms(rooms));
        socket.emit('update_dms', getUserDMs(rooms, me.username));
        socket.join('lobby'); // Для общих обновлений
    });

    // --- Rooms & DMs ---

    socket.on('create_room', (d) => {
        if(!me) return;
        const r = read('rooms.json'), id = 'room_' + Date.now();
        r[id] = { 
            id, title: d.title, owner: me.username, 
            password: d.password || null, hasPass: !!d.password, 
            mode: d.mode, msgs: [], pinned: null, bannedWords: [],
            isDm: false 
        };
        write('rooms.json', r); 
        io.to('lobby').emit('update_rooms', getPublicRooms(r));
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
                owner: 'system' // В ЛС нет владельца
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
        socket.emit('update_rooms', getPublicRooms(rooms));
    });

    socket.on('delete_room', (roomId) => {
        if(!me) return;
        const rooms = read('rooms.json');
        const r = rooms[roomId];
        if (r && (r.owner === me.username || isAdmin)) {
            delete rooms[roomId];
            write('rooms.json', rooms);
            io.to('lobby').emit('update_rooms', getPublicRooms(rooms));
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

        if(!r.isDm && r.password && r.password !== d.password && !isAdmin) return socket.emit('error', 'Неверный пароль!');
        
        socket.join(d.id);
        const data = {...r}; delete data.password;
        // Для ЛС меняем заголовок на имя собеседника
        if(r.isDm) {
            const other = r.participants.find(u => u !== me.username) || me.username;
            data.title = other;
        }
        socket.emit('room_history', data);
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
            // !запрет(слово)
            const banMatch = d.text.match(/^!запрет\((.+)\)$/);
            if(banMatch) {
                if(r.owner !== me.username && !isAdmin) return socket.emit('error', 'Только владелец может запрещать слова.');
                const word = banMatch[1].trim();
                r.bannedWords.push(word);
                write('rooms.json', rooms);
                
                // Системное сообщение о запрете
                const sysMsg = createMsg('System', null, `Слово "${word}" теперь запрещено.`, 'text', r.owner);
                r.msgs.push(sysMsg);
                io.to(d.roomId).emit('new_msg', sysMsg);
                return; // Команда не публикуется как сообщение пользователя
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
                `, 'text', r.owner);
                
                r.msgs.push(sysMsg);
                write('rooms.json', rooms);
                io.to(d.roomId).emit('new_msg', sysMsg);
                return;
            }
        }

        // Стандартная отправка
        if (r.mode === 'channel' && r.owner !== me.username && !isAdmin) return;

        const m = createMsg(me.username, me.font, d.text, d.type, r.owner, d.file, d.replyTo);
        
        r.msgs.push(m); 
        if(r.msgs.length > 200) r.msgs.shift();
        
        write('rooms.json', rooms); 
        io.to(d.roomId).emit('new_msg', m);
        
        // Если это ЛС, обновляем списки участников (чтобы чат поднялся наверх или появился)
        if(r.isDm) {
            r.participants.forEach(p => {
                // Это упрощение, в идеале отправлять конкретным сокетам
                // Но так как у нас нет маппинга юзер->сокет, полагаемся на refresh при входе или ручном обновлении
                // Для MVP: просто ничего не делаем, история обновится сама у тех кто внутри.
            });
        }
    });

    function createMsg(user, font, text, type, roomOwner, file = null, replyTo = null) {
        return {
            id: Date.now() + Math.random(), 
            user, userFont: font, text, type, file, 
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
            roomOwner, replyTo
        };
    }

    socket.on('delete_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && (r.owner === me.username || isAdmin || r.isDm)) { // В ЛС любой может удалять (условно)
            r.msgs = r.msgs.filter(m => m.id != d.msgId);
            if(r.pinned && r.pinned.id == d.msgId) r.pinned = null;
            write('rooms.json', rooms); io.to(d.roomId).emit('msg_deleted', d.msgId);
            if(!r.pinned) io.to(d.roomId).emit('update_pin', null);
        }
    });

    socket.on('pin_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && (r.owner === me.username || isAdmin)) {
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
});

server.listen(3000, () => console.log('VOY v4.0 Messenger Update running on 3000'));