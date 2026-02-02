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

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f)));
const write = (f, d) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2));

const init = (f, d) => { if (!fs.existsSync(path.join(DATA_DIR, f))) write(f, d); };
init('users.json', []); init('rooms.json', {});

app.use('/fonts', express.static(FONTS_DIR));
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    let me = null;

    socket.on('register', (d) => {
        const u = read('users.json');
        if (u.find(x => x.username === d.username)) return socket.emit('error', 'Ник занят!');
        u.push({ username: d.username, password: d.password, bio: "", font: '', avatar: '' });
        write('users.json', u); socket.emit('alert', 'Готово! Войдите.');
    });

    socket.on('login', (d) => {
        const user = read('users.json').find(x => x.username === d.username && x.password === d.password);
        if (!user) return socket.emit('error', 'Ошибка входа');
        me = user; socket.emit('auth_ok', me); socket.emit('update_rooms', read('rooms.json'));
    });

    socket.on('create_room', (d) => {
        if(!me) return;
        const r = read('rooms.json'), id = 'room_' + Date.now();
        r[id] = { id, title: d.title, owner: me.username, password: d.password || null, hasPass: !!d.password, mode: d.mode, msgs: [], pinned: null };
        write('rooms.json', r); io.emit('update_rooms', r);
    });

    socket.on('join_room', (d) => {
        const r = read('rooms.json')[d.id];
        if(!r) return;
        if(r.password && r.password !== d.password) return socket.emit('error', 'Неверный пароль!');
        socket.join(d.id);
        const data = {...r}; delete data.password; // Не отправляем пароль клиенту
        socket.emit('room_history', data);
    });

    socket.on('send_msg', (d) => {
        if(!me) return;
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(!r || (r.mode === 'channel' && r.owner !== me.username)) return;
        const m = { id: Date.now()+Math.random(), user: me.username, userFont: me.font, text: d.text, type: d.type, file: d.file, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), roomOwner: r.owner };
        r.msgs.push(m); if(r.msgs.length > 200) r.msgs.shift();
        write('rooms.json', rooms); io.to(d.roomId).emit('new_msg', m);
    });

    socket.on('delete_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && r.owner === me.username) {
            r.msgs = r.msgs.filter(m => m.id != d.msgId);
            if(r.pinned && r.pinned.id == d.msgId) r.pinned = null;
            write('rooms.json', rooms); io.to(d.roomId).emit('msg_deleted', d.msgId);
            if(!r.pinned) io.to(d.roomId).emit('update_pin', null);
        }
    });

    socket.on('pin_msg', (d) => {
        const rooms = read('rooms.json'), r = rooms[d.roomId];
        if(r && r.owner === me.username) {
            r.pinned = d.msgId ? r.msgs.find(m => m.id == d.msgId) : null;
            write('rooms.json', rooms); io.to(d.roomId).emit('update_pin', r.pinned);
        }
    });

    socket.on('save_font_file', (d) => {
        if(!me) return;
        const name = `pua_${me.username}_${Date.now()}.ttf`, u = read('users.json');
        fs.writeFileSync(path.join(FONTS_DIR, name), Buffer.from(d.file.split(',')[1], 'base64'));
        const idx = u.findIndex(x => x.username === me.username);
        u[idx].font = `/fonts/${name}`; me = u[idx];
        write('users.json', u); socket.emit('auth_ok', me); io.emit('font_update', { user: me.username, font: me.font });
    });

    socket.on('update_profile', (d) => {
        if(!me) return;
        const u = read('users.json'), idx = u.findIndex(x => x.username === me.username);
        u[idx].bio = d.bio || u[idx].bio; u[idx].avatar = d.avatar || u[idx].avatar;
        write('users.json', u); me = u[idx]; socket.emit('auth_ok', me);
    });
});

server.listen(3000, () => console.log('VOY v3.3 Admin Edition on port 3000'));