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

// Хранилище данных в оперативной памяти сервера (замена SQLite для стабильности на Render)
const users = [];
const chats = [];
const chatMembers = [];
const messages = [];

// Настройка папки для загрузки файлов
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
    const exists = users.find(u => u.id === id);
    return exists ? generateUID() : id;
}

// --- API ЭНДПОИНТЫ ---

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    
    const exists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) return res.status(400).json({ error: 'Пользователь с таким никнеймом уже существует' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const uid = generateUID();
        const createdAt = new Date().toLocaleString('ru-RU');
        
        users.push({ id: uid, username, password: hashedPassword, created_at: createdAt });
        res.json({ id: uid, username, created_at: createdAt });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
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
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname, fileType: req.file.mimetype });
});

// --- ЛОГИКА SOCKET.IO ---

io.on('connection', (socket) => {
    socket.on('user:join', (userId) => {
        socket.userId = userId;
        socket.join(userId);
        
        // Поиск всех чатов пользователя
        const myChatIds = chatMembers.filter(m => m.user_id === userId).map(m => m.chat_id);
        const userChats = chats.filter(c => myChatIds.includes(c.id));
        
        userChats.forEach(chat => socket.join(chat.id));
        socket.emit('user:chats', userChats);
    });

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

    socket.on('profile:delete', (userId) => {
        const index = users.findIndex(u => u.id === userId);
        if (index !== -1) users.splice(index, 1);
        
        // Удаляем из членов чата
        for (let i = chatMembers.length - 1; i >= 0; i--) {
            if (chatMembers[i].user_id === userId) chatMembers.splice(i, 1);
        }
        socket.emit('profile:deleted', { success: true });
    });

    socket.on('chat:create_private', ({ userId, targetId }) => {
        // Если это запрос на открытие уже существующего чата по его ID
        let existingChat = chats.find(c => c.id === targetId);
        
        if (!existingChat) {
            // Если это поиск нового друга по его 10-значному ID
            const target = users.find(u => u.id === targetId);
            if (!target) return socket.emit('chat:error', 'Пользователь с таким ID не найден');
            if (userId === targetId) return socket.emit('chat:error', 'Нельзя создать чат с самим собой');

            // Проверяем, нет ли уже ЛС между ними
            const commonChatMember = chatMembers.find(m1 => 
                m1.user_id === userId && 
                chatMembers.some(m2 => m2.chat_id === m1.chat_id && m2.user_id === targetId)
            );

            if (commonChatMember) {
                existingChat = chats.find(c => c.id === commonChatMember.chat_id);
            } else {
                // Создаем новое ЛС
                const chatId = 'chat_' + Date.now();
                existingChat = { id: chatId, name: target.username, is_group: 0 };
                chats.push(existingChat);
                chatMembers.push({ chat_id: chatId, user_id: userId });
                chatMembers.push({ chat_id: chatId, user_id: targetId });

                io.to(targetId).emit('chat:new', existingChat);
            }
        }

        socket.join(existingChat.id);
        const chatMessages = messages.filter(m => m.chat_id === existingChat.id);
        socket.emit('chat:opened', { chatId: existingChat.id, messages: chatMessages });
    });

    socket.on('chat:create_group', ({ userId, groupName }) => {
        const chatId = 'group_' + Date.now();
        const newGroup = { id: chatId, name: groupName, is_group: 1 };
        
        chats.push(newGroup);
        chatMembers.push({ chat_id: chatId, user_id: userId });
        
        socket.join(chatId);
        socket.emit('chat:new', newGroup);
        socket.emit('chat:opened', { chatId, messages: [] });
    });

    socket.on('message:send', (data) => {
        const { chatId, senderId, senderName, text, fileUrl, fileName, fileType } = data;
        const msgId = 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5);
        const timestamp = new Date().toLocaleString('ru-RU');

        const newMsg = { id: msgId, chatId, senderId, senderName, text: text || null, file_url: fileUrl || null, file_name: fileName || null, file_type: fileType || null, timestamp, is_edited: 0 };
        messages.push(newMsg);

        io.to(chatId).emit('message:new', newMsg);
    });

    socket.on('message:delete', ({ msgId, chatId }) => {
        const index = messages.findIndex(m => m.id === msgId);
        if (index !== -1) messages.splice(index, 1);
        io.to(chatId).emit('message:deleted', { msgId });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер Ink chat успешно запущен на порту ${PORT}`);
});
    console.log(`Сервер мессенджера успешно запущен на порту ${PORT}`);
});

