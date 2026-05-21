const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// База данных в памяти сервера
let db = {
    users: [
        { id: "4829104952", name: "User1", pass: "1234", created_at: "16.02.2026", last_seen: Date.now() },
        {name: "Inker", pass: "admin", last_seen: Date.now() } // Аккаунт с галочкой
    ],
    messages: [],
    groups: []
};

// Функция обновления времени «В сети»
const updateHeartbeat = (username) => {
    if (!username) return;
    let user = db.users.find(u => u.name.toLowerCase() === username.toLowerCase());
    if (user) user.last_seen = Date.now();
};

// --- API: СЕССИЯ И АКТИВНОСТЬ ---
app.post('/api/heartbeat', (req, res) => {
    const { username } = req.body;
    updateHeartbeat(username);
    res.json({ success: true });
});

app.post('/api/register', (req, res) => {
    const { name, pass, id, created_at } = req.body;
    if (!name || !pass || !id) return res.status(400).json({ error: "Заполните все поля!" });
    if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: "Это имя уже занято!" });
    }
    const newUser = { id, name, pass, created_at, last_seen: Date.now() };
    db.users.push(newUser);
    res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
    const { name, pass } = req.body;
    const user = db.users.find(u => u.name.toLowerCase() === name.trim().toLowerCase() && u.pass === pass.trim());
    if (!user) return res.status(400).json({ error: "Неверные данные для входа!" });
    user.last_seen = Date.now();
    res.json({ success: true, user });
});

// --- API: ПОИСК И СТАТУСЫ ПОЛЬЗОВАТЕЛЕЙ ---
app.get('/api/find-user', (req, res) => {
    const { searchId } = req.query;
    const match = db.users.find(u => String(u.id).trim() === String(searchId).trim());
    if (!match) return res.json({ matches: null });
    
    // Вычисляем статус сети (онлайн, если активность была меньше 10 секунд назад)
    const isOnline = (Date.now() - match.last_seen) < 10000;
    res.json({ matches: { ...match, isOnline } });
});

// Получение списка статусов онлайн для друзей
app.post('/api/users/status', (req, res) => {
    const { usernames } = req.body;
    if (!usernames || !Array.isArray(usernames)) return res.json({ statuses: {} });
    
    let statuses = {};
    usernames.forEach(name => {
        let u = db.users.find(user => user.name.toLowerCase() === name.toLowerCase());
        if (u) {
            statuses[name] = {
                isOnline: (Date.now() - u.last_seen) < 10000,
                isVerified: u.pass && u.pass.includes("[Ink_admin_2552]")
            };
        }
    });
    res.json({ statuses });
});

// --- API: КАТАЛОГ ДИАЛОГОВ (СОХРАНЕНИЕ ПОСЛЕ ПЕРЕЗАХОДА) ---
app.get('/api/active-dialogs', (req, res) => {
    const { username } = req.query;
    if (!username) return res.json({ dialogs: [] });

    // Находим всех людей, с кем у пользователя была переписка
    let dialogPartners = new Set();
    db.messages.forEach(m => {
        if (!m.target.startsWith("Группа: ")) {
            if (m.sender.toLowerCase() === username.toLowerCase() && m.recipient) dialogPartners.add(m.recipient);
            if (m.recipient && m.recipient.toLowerCase() === username.toLowerCase()) dialogPartners.add(m.sender);
        }
    });

    let dialogs = Array.from(dialogPartners).map(name => {
        let u = db.users.find(user => user.name.toLowerCase() === name.toLowerCase());
        return {
            name: name,
            id: u ? u.id : "",
            isVerified: u && u.pass ? u.pass.includes("[Ink_admin_2552]") : false
        };
    });

    res.json({ dialogs });
});

// --- API: СООБЩЕНИЯ И СТАТУС ПРОЧТЕНИЯ ---
app.get('/api/messages', (req, res) => res.json({ messages: db.messages }));

app.post('/api/messages/send', (req, res) => {
    const { sender, target, recipient, text } = req.body;
    updateHeartbeat(sender);
    const newMsg = { id: Date.now(), sender, target, recipient, text, read: false };
    db.messages.push(newMsg);
    res.json({ success: true });
});

// Отметка сообщений в чате как прочтенных
app.post('/api/messages/read', (req, res) => {
    const { chatTarget, username } = req.body;
    updateHeartbeat(username);
    db.messages.forEach(m => {
        if (m.target === chatTarget && m.sender.toLowerCase() !== username.toLowerCase()) {
            m.read = true;
        }
    });
    res.json({ success: true });
});

app.post('/api/messages/delete', (req, res) => {
    const { id, username } = req.body;
    let msg = db.messages.find(m => String(m.id) === String(id));
    if (msg && msg.sender === username) {
        db.messages = db.messages.filter(m => String(m.id) !== String(id));
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Нельзя удалить" });
});

app.post('/api/messages/edit', (req, res) => {
    const { id, username, newText } = req.body;
    let msg = db.messages.find(m => String(m.id) === String(id));
    if (msg && msg.sender === username) {
        msg.text = newText;
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Нельзя изменить" });
});

app.get('/api/groups', (req, res) => res.json({ groups: db.groups }));
app.post('/api/groups/create', (req, res) => {
    const { gName, creator, members } = req.body;
    if (db.groups.some(g => g.name.toLowerCase() === gName.toLowerCase())) return app.status(400).json({ error: "Существует" });
    db.groups.push({ name: gName, creator, members });
    db.messages.push({ id: Date.now(), sender: "Система", target: "Группа: " + gName, recipient: null, text: `Группа создана`, read: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен`));
