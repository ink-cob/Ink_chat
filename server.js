const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Временная база данных в памяти сервера
const users = [];
const chats = [];
const chatMembers = [];
const messages = [];

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'))
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateUID() {
    let id = '';
    for (let i = 0; i < 10; i++) id += Math.floor(Math.random() * 10);
    return users.find(u => u.id === id) ? generateUID() : id;
}

// API Эндпоинты
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'Никнейм уже существует' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const uid = generateUID();
    const createdAt = new Date().toLocaleString('ru-RU');
    users.push({ id: uid, username, password: hashedPassword, created_at: createdAt });
    res.json({ id: uid, username, created_at: createdAt });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: 'Неверный никнейм или пароль' });
    }
    res.json({ id: user.id, username: user.username, created_at: user.created_at });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
    res.json({ fileUrl: `/uploads/${req.file.filename}`, fileName: req.file.originalname, fileType: req.file.mimetype });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io Логика мессенджера
io.on('connection', (socket) => {
    socket.on('user:join', (userId) => {
        socket.userId = userId;
        socket.join(userId);
        const myChatIds = chatMembers.filter(m => m.user_id === userId).map(m => m.chat_id);
        const userChats = chats.filter(c => myChatIds.includes(c.id));
        userChats.forEach(chat => socket.join(chat.id));
        socket.emit('user:chats', userChats);
    });

    // Редактирование данных профиля
    socket.on('profile:update', async ({ userId, newUsername, newPassword }) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        if (newUsername) {
            const exists = users.find(u => u.username.toLowerCase() === newUsername.toLowerCase() && u.id !== userId);
            if (exists) return socket.emit('profile:updated', { success: false, error: 'Никнейм уже занят' });
            user.username = newUsername;
        }
        if (newPassword) {
            user.password = await bcrypt.hash(newPassword, 10);
        }
        
        socket.emit('profile:updated', { success: true, user: { id: user.id, username: user.username, created_at: user.created_at } });
    });

    // Полное удаление аккаунта
    socket.on('profile:delete', (userId) => {
        const index = users.findIndex(u => u.id === userId);
        if (index !== -1) users.splice(index, 1);
        for (let i = chatMembers.length - 1; i >= 0; i--) {
            if (chatMembers[i].user_id === userId) chatMembers.splice(i, 1);
        }
        socket.emit('profile:deleted', { success: true });
    });

    socket.on('chat:create_private', ({ userId, targetId }) => {
        let existingChat = chats.find(c => c.id === targetId);
        if (!existingChat) {
            const target = users.find(u => u.id === targetId);
            if (!target) return socket.emit('chat:error', 'Пользователь не найден');
            if (userId === targetId) return socket.emit('chat:error', 'Нельзя чатиться с собой');
            const common = chatMembers.find(m1 => m1.user_id === userId && chatMembers.some(m2 => m2.chat_id === m1.chat_id && m2.user_id === targetId));
            if (common) {
                existingChat = chats.find(c => c.id === common.chat_id);
            } else {
                const chatId = 'chat_' + Date.now();
                existingChat = { id: chatId, name: target.username, is_group: 0 };
                chats.push(existingChat);
                chatMembers.push({ chat_id: chatId, user_id: userId }, { chat_id: chatId, user_id: targetId });
                io.to(targetId).emit('chat:new', existingChat);
            }
        }
        socket.join(existingChat.id);
        socket.emit('chat:opened', { chatId: existingChat.id, messages: messages.filter(m => m.chat_id === existingChat.id) });
    });

    socket.on('message:send', (data) => {
        const { chatId, senderId, senderName, text, fileUrl, fileName, fileType } = data;
        const msg = { id: 'msg_' + Date.now(), chatId, senderId, senderName, text: text || null, file_url: fileUrl || null, file_name: fileName || null, file_type: fileType || null, timestamp: new Date().toLocaleString('ru-RU') };
        messages.push(msg);
        io.to(chatId).emit('message:new', msg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер Ink chat запущен на порту ${PORT}`);
});
