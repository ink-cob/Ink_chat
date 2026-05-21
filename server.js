const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
const server = http.createServer(app);

// Разрешаем фронтенду с любого хостинга (включая GitHub Pages) обращаться к серверу
app.use(cors());
app.use(express.json());

// Локальная база данных в памяти сервера
let db = {
    users: [{ id: "4829104952", name: "User1", pass: "1234", created_at: "16.02.2026" }],
    messages: [],
    groups: []
};

// --- API: СЕССИЯ И РЕГИСТРАЦИЯ ---
app.post('/api/register', (req, res) => {
    const { name, pass, id, created_at } = req.body;
    if (!name || !pass || !id) return res.status(400).json({ error: "Заполните все поля!" });
    if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: "Это имя уже занято!" });
    }
    const newUser = { id, name, pass, created_at };
    db.users.push(newUser);
    res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
    const { name, pass } = req.body;
    const user = db.users.find(u => u.name.toLowerCase() === name.trim().toLowerCase() && u.pass === pass.trim());
    if (!user) return res.status(400).json({ error: "Неверные данные для входа!" });
    res.json({ success: true, user });
});

// --- API: ПОИСК ПО ID ---
app.get('/api/find-user', (req, res) => {
    const { searchId } = req.query;
    const matches = db.users.filter(u => String(u.id).trim() === String(searchId).trim());
    res.json({ matches });
});

// --- API: ПРОФИЛЬ ---
app.post('/api/update-profile', (req, res) => {
    const { id, newName, newPass } = req.body;
    let user = db.users.find(u => String(u.id).trim() === String(id).trim());
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    if (newName) {
        const oldName = user.name;
        if (oldName !== newName) {
            if (db.users.some(u => u.name.toLowerCase() === newName.toLowerCase() && String(u.id).trim() !== String(id).trim())) {
                return res.status(400).json({ error: "Это имя уже занято!" });
            }
            db.messages.forEach(m => {
                if (m.sender === oldName) m.sender = newName;
                if (m.recipient === oldName) m.recipient = newName;
            });
            db.groups.forEach(g => {
                if (g.creator === oldName) g.creator = newName;
                g.members = g.members.map(m => m === oldName ? newName : m);
            });
        }
        user.name = newName;
    }
    if (newPass) user.pass = newPass;
    res.json({ success: true, user });
});

// --- API: ГРУППЫ ---
app.get('/api/groups', (req, res) => res.json({ groups: db.groups }));

app.post('/api/groups/create', (req, res) => {
    const { gName, creator, members } = req.body;
    if (db.groups.some(g => g.name.toLowerCase() === gName.toLowerCase())) {
        return res.status(400).json({ error: "Группа с таким названием уже существует!" });
    }
    const newGroup = { name: gName, creator, members };
    db.groups.push(newGroup);
    db.messages.push({
        id: Date.now(), sender: "Система", target: "Группа: " + gName, recipient: null,
        text: `Группа "${gName}" успешно создана. Создатель: ${creator}. Участники: ${members.join(', ')}`
    });
    res.json({ success: true });
});

app.post('/api/groups/leave', (req, res) => {
    const { gName, username } = req.body;
    let group = db.groups.find(g => g.name === gName);
    if (!group) return res.status(404).json({ error: "Группа не найдена" });

    if (group.creator === username) {
        db.groups = db.groups.filter(g => g.name !== gName);
    } else {
        group.members = group.members.filter(m => m !== username);
        db.messages.push({ id: Date.now(), sender: "Система", target: "Группа: " + gName, recipient: null, text: `${username} покинул группу.` });
    }
    res.json({ success: true });
});

// --- API: СООБЩЕНИЯ ---
app.get('/api/messages', (req, res) => res.json({ messages: db.messages }));

app.post('/api/messages/send', (req, res) => {
    const { sender, target, recipient, text } = req.body;
    const newMsg = { id: Date.now(), sender, target, recipient, text };
    db.messages.push(newMsg);
    res.json({ success: true });
});

app.post('/api/messages/delete', (req, res) => {
    const { id, username } = req.body;
    let msg = db.messages.find(m => String(m.id) === String(id));
    if (msg && msg.sender === username) {
        db.messages = db.messages.filter(m => String(m.id) !== String(id));
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Нельзя удалить это сообщение" });
});

app.post('/api/messages/edit', (req, res) => {
    const { id, username, newText } = req.body;
    let msg = db.messages.find(m => String(m.id) === String(id));
    if (msg && msg.sender === username) {
        msg.text = newText;
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Нельзя отредактировать это сообщение" });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
