const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Хранилище в оперативной памяти (без сторонних баз данных)
const users = [];
const chats = [];
const chatMembers = [];
const messages = [];

app.use(express.json());

function generateUID() {
    let id = '';
    for (let i = 0; i < 10; i++) id += Math.floor(Math.random() * 10);
    return users.find(u => u.id === id) ? generateUID() : id;
}

// --- API ---
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

// --- ИНТЕРФЕЙС (ФРОНТЕНД) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ink chat</title>
    <link rel="stylesheet" href="https://cloudflare.com">
    <style>
        :root {
            --bg: #eceff1; --sidebar-bg: #ffffff; --primary: #1a237e;
            --primary-hover: #12185c; --text-muted: #707579; --border: #dfe5ec;
            --my-msg: #e8eaf6; --other-msg: #ffffff; --chat-bg: #f4f4f5;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: sans-serif; }
        body, html { height: 100%; overflow: hidden; background: var(--bg); }
        .screen { display: none; width: 100%; height: 100%; }
        .screen.active { display: flex; }
        
        /* Авторизация */
        #auth-screen { justify-content: center; align-items: center; background: #517da2; }
        .auth-card { background: white; padding: 40px; border-radius: 12px; width: 350px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .auth-logo { width: 70px; height: 70px; background: var(--primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 30px; }
        .auth-card input { width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid var(--border); border-radius: 6px; outline: none; }
        .auth-card button { width: 100%; padding: 10px; background: var(--primary); border: none; color: white; border-radius: 6px; font-weight: bold; cursor: pointer; margin-bottom: 5px; }
        .auth-card button:hover { background: var(--primary-hover); }
        .auth-card .btn-secondary { background: none; color: var(--primary); border: 1px solid var(--primary); }
        .alert-error { color: red; margin-bottom: 10px; display: none; font-size: 14px; }
        
        /* Главное окно */
        #app-screen { height: 100vh; }
        .sidebar { width: 300px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: white; }
        .sidebar-header { display: flex; padding: 10px; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); }
        .sidebar-header button { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted); padding: 5px; }
        .search-bar { background: #f1f5f9; display: flex; align-items: center; padding: 5px 10px; border-radius: 15px; flex: 1; }
        .search-bar input { background: none; border: none; outline: none; width: 100%; margin-left: 5px; }
        .chats-list { flex: 1; overflow-y: auto; }
        .chat-item { display: flex; padding: 12px 10px; gap: 10px; cursor: pointer; border-bottom: 1px solid #f5f5f5; align-items: center; }
        .chat-item:hover { background: #f4f4f5; }
        .chat-item.active { background: #e8eaf6; }
        .avatar { width: 40px; height: 40px; background: #a2bde6; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        
        /* Чат */
        .chat-window { flex: 1; display: flex; flex-direction: column; background-color: var(--chat-bg); background-image: url('https://githubusercontent.com'); position: relative; }
        .chat-stub { position: absolute; width:100%; height:100%; background: #f4f4f5; display:none; align-items:center; justify-content:center; color: var(--text-muted); }
        .chat-stub.active { display: flex; }
        .chat-active { display: flex; flex-direction: column; height: 100%; }
        .chat-header { background: white; padding: 10px; display: flex; align-items: center; border-bottom: 1px solid var(--border); }
        .chat-info { display: flex; align-items: center; gap: 10px; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        
        /* Сообщения */
        .msg-row { display: flex; width: 100%; position: relative; }
        .msg-row.my { justify-content: flex-end; }
        .msg-row.other { justify-content: flex-start; }
        .msg-bubble { max-width: 60%; padding: 8px 12px; border-radius: 8px; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1); cursor: pointer; position: relative; }
        .msg-row.my .msg-bubble { background: var(--my-msg); }
        .msg-row.other .msg-bubble { background: var(--other-msg); }
        .msg-author { font-size: 11px; font-weight: bold; color: var(--primary); margin-bottom: 2px; }
        .msg-time { font-size: 10px; color: gray; text-align: right; display: block; margin-top: 3px; }
        .msg-actions { display: none; position: absolute; background: white; border: 1px solid var(--border); border-radius: 4px; z-index: 10; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        .msg-actions button { display: block; width: 100%; padding: 5px 10px; border: none; background: none; text-align: left; cursor: pointer; font-size: 12px; }
        .msg-actions button:hover { background: #f1f5f9; }
        
        .chat-input-panel { background: white; padding: 10px; display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); }
        .input-wrapper { flex: 1; }
        .input-wrapper input { width: 100%; padding: 10px; border: none; background: #f1f5f9; border-radius: 15px; outline: none; }
        #btn-send-message { background: none; border: none; color: var(--primary); font-size: 20px; cursor: pointer; }
        
        /* Модальное окно */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 100; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: white; width: 350px; border-radius: 8px; padding: 20px; }
        .modal-header { display: flex; justify-content: space-between; margin-bottom: 15px; align-items: center; }
        .modal-close { background: none; border: none; font-size: 24px; cursor: pointer; }
        .modal-body input { width: 100%; padding: 10px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; outline: none; }
        .modal-body button { width: 100%; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .btn-danger { background: #e53935 !important; margin-top: 10px; }
        .profile-info-block { background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 15px; font-size: 14px; }
        hr { margin: 15px 0; border: 0; border-top: 1px solid var(--border); }
    </style>
</head>
<body>

    <div id="auth-screen" class="screen active">
        <div class="auth-card">
            <div class="auth-logo"><i class="fa-paper-plane"></i></div>
            <h2>Войти в Ink chat</h2>
            <div class="alert-error" id="auth-error"></div>
            <input type="text" id="auth-username" placeholder="Никнейм">
            <input type="password" id="auth-password" placeholder="Пароль">
            <button id="btn-login">ВОЙТИ</button>
            <button id="btn-register" class="btn-secondary">СОЗДАТЬ АККАУНТ</button>
        </div>
    </div>

    <div id="app-screen" class="screen">
        <aside class="sidebar">
            <div class="sidebar-header">
                <button id="btn-menu"><i class="fa-bars"></i></button>
                <div class="search-bar">
                    <i class="fa-search"></i>
                    <input type="text" id="search-id" placeholder="ID друга или имя группы...">
                </div>
                <button id="btn-add-chat" title="Создать/Найти"><i class="fa-plus"></i></button>
            </div>
            <div class="chats-list" id="chats-container"></div>
        </aside>

        <main class="chat-window">
            <div id="chat-stub" class="chat-stub active"><p>Выберите чат или добавьте друга по ID</p></div>
            <div id="chat-active" class="chat-active">
                <header class="chat-header">
                    <div class="chat-info">
                        <div class="avatar" id="active-chat-avatar">?</div>
                        <div><h3 id="active-chat-name">Чат</h3></div>
                    </div>
                </header>
                <div class="chat-messages" id="messages-container"></div>
                <footer class="chat-input-panel">
                    <div class="input-wrapper"><input type="text" id="message-input" placeholder="Напишите сообщение..."></div>
                    <button id="btn-send-message"><i class="fa-paper-plane"></i></button>
                </footer>
            </div>
        </main>
    </div>

    <div id="modal-settings" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Профиль</h3>
                <button class="modal-close" id="btn-close-settings">&times;</button>
            </div>
            <div class="modal-body">
                <div class="profile-info-block">
                    <p><strong>Ваш ID:</strong> <span id="prof-id">-</span></p>
                    <p><strong>Создан:</strong> <span id="prof-date">-</span></p>
                </div>
                <hr>
                <input type="text" id="settings-username" placeholder="Новый никнейм">
                <input type="password" id="settings-password" placeholder="Новый пароль">
                <button id="btn-save-profile">Сохранить изменения</button>
                <button id="btn-delete-account" class="btn-danger">Удалить аккаунт</button>
            </div>
        </div>
    </div>

    <div id="msg-context-menu" class="msg-actions">
        <button id="ctx-edit">Изменить</button>
        <button id="ctx-delete" style="color:red;">Удалить</button>
    </div>

    <script src="https://socket.io"></script>
    <script>
        const socket = typeof io !== 'undefined' ? io() : null;
        let currentUser = null;
        let activeChatId = null;
        let selectedMsgId = null;

        const getEl = (id) => document.getElementById(id);

        // Авторизация
        getEl('btn-login').addEventListener('click', () => auth('/api/auth/login'));
        getEl('btn-register').addEventListener('click', () => auth('/api/auth/register'));

        async function auth(url) {
            const username = getEl('auth-username').value.trim();
            const password = getEl('auth-password').value;
            if(!username || !password) return alert('Заполните поля');
            
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await res.json();
            
            if (data.error) {
                getEl('auth-error').innerText = data.error;
                getEl('auth-error').style.display = 'block';
            } else {
                currentUser = data;
                getEl('auth-screen').classList.remove('active');
                getEl('app-screen').classList.add('active');
                alert(\`Ваш уникальный 10-значный ID: \${data.id}\`);
                if (socket) socket.emit('user:join', data.id);
            }
        }

        // Добавление чата / группы
        getEl('btn-add-chat').addEventListener('click', () => {
            const query = getEl('search-id').value.trim();
            if(!query) return alert('Введите ID друга или название группы');
            if(query.length === 10 && /^\\d+$/.test(query)) {
                if (socket) socket.emit('chat:create_private', { userId: currentUser.id, targetId: query });
            } else {
                if (socket) socket.emit('chat:create_group', { userId: currentUser.id, groupName: query });
            }
            getEl('search-id').value = '';
        });

        if (socket) {
            socket.on('user:chats', (chats) => {
                const container = getEl('chats-container');
                container.innerHTML = '';
                chats.forEach(chat => {
                    const item = document.createElement('div');
                    item.className = \`chat-item \${chat.id === activeChatId ? 'active' : ''}\`;
                    item.innerHTML = \`<div class="avatar">\${chat.name.substring(0,2).toUpperCase()}</div><div><h4>\${chat.name}</h4></div>\`;
                    item.onclick = () => {
                        activeChatId = chat.id;
                        getEl('chat-stub').classList.remove('active');
                        getEl('chat-active').classList.add('active');
                        getEl('active-chat-name').innerText = chat.name;
                        getEl('active-chat-avatar').innerText = chat.name.substring(0,2).toUpperCase();
                        socket.emit('chat:create_private', { userId: currentUser.id, targetId: chat.id });
                    };
                    container.appendChild(item);
                });
            });

            socket.on('chat:opened', ({ chatId, messages }) => {
                if(chatId !== activeChatId) return;
                const container = getEl('messages-container');
                container.innerHTML = '';
                messages.forEach(msg => displayMessage(msg));
                container.scrollTop = container.scrollHeight;
            });

            socket.on('message:new', (msg) => {
                if(msg.chatId === activeChatId) {
                    displayMessage(msg);
                    getEl('messages-container').scrollTop = getEl('messages-container').scrollHeight;
                }
            });

            socket.on('chat:new', () => socket.emit('user:join', currentUser.id));
            socket.on('chat:error', alert);
        }

        function displayMessage(msg) {
            const isMy = msg.sender_id === currentUser.id;
            const row = document.createElement('div');
            row.className = \`msg-row \${isMy ? 'my' : 'other'}\`;
            row.id = msg.id;
            
            let html = \`<div class="msg-bubble">\`;
            if(!isMy) html += \`<div class="msg-author">\${msg.sender_name}</div>\`;
            html += \`<span class="msg-text">\${msg.text}</span><span class="msg-time">\${msg.timestamp}</span></div>\`;
            row.innerHTML = html;
            
            // Контекстное меню по клику на сообщение
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                if(!isMy) return; // Модифицировать можно только свои сообщения
                selectedMsgId = msg.id;
                const menu = getEl('msg-context-menu');
                menu.style.display = 'block';
                menu.style.top = e.pageY + 'px';
                menu.style.left = e.pageX + 'px';
            });

            getEl('messages-container').appendChild(row);
        }

        // Отправка
        getEl('btn-send-message').addEventListener('click', sendMessage);
        getEl('message-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });

        function sendMessage() {
            const input = getEl('message-input');
            if(!input.value.trim() || !activeChatId) return;
            if (socket) socket.emit('message:send', { chatId: activeChatId, senderId: currentUser.id, senderName: currentUser.username, text: input.value.trim() });
            input.value = '';
        }

        // Закрытие меню по клику в любом месте
        document.addEventListener('click', () => { getEl('msg-context-menu').style.display = 'none'; });

        // Удаление сообщения
        getEl('ctx-delete').addEventListener('click', () => {
            if(confirm('Удалить сообщение?')) {
                // Локальное удаление для простоты примера в памяти
                const el = document.getElementById(selectedMsgId);
                if(el) el.remove();
            }
        });

        // Изменение сообщения
        getEl('ctx-edit').addEventListener('click', () => {
            const el = document.getElementById(selectedMsgId);
            const textSpan = el.querySelector('.msg-text');
            const newText = prompt('Редактировать сообщение:', textSpan.innerText);
            if(newText && newText.trim()) {
                textSpan.innerText = newText.trim() + ' (изм.)';
            }
        });

        // Настройки профиля
        getEl('btn-menu').addEventListener('click', () => {
            getEl('prof-id').innerText = currentUser.id;
            getEl('prof-date').innerText = currentUser.created_at;
            getEl('modal-settings').classList.add('active');
        });
        getEl('btn-close-settings').addEventListener('click', () => getEl('modal-settings').classList.remove('active'));

        getEl('btn-save-profile').addEventListener('click', () => {
            const user = getEl('settings-username').value.trim();
            const pass = getEl('settings-password').value.trim();
            if(user) currentUser.username = user;
            alert('Профиль обновлен локально!');
            getEl('modal-settings').classList.remove('active');
        });

        getEl('btn-delete-account').addEventListener('click', () => {
            if(confirm('Удалить аккаунт?')) window.location.reload();
        });
    </script>
</body>
</html>
    `);
});

io.on('connection', (socket) => {
    socket.on('user:join', (userId) => {
        socket.userId = userId; socket.join(userId);
        const myChatIds = chatMembers.filter(m => m.user_id === userId).map(m => m.chat_id);
        const userChats = chats.filter(c => myChatIds.includes(c.id));
        userChats.forEach(chat => socket.join(chat.id));
        socket.emit('user:chats', userChats);
    });

    socket.on('chat:create_private', ({ userId, targetId }) => {
        let existingChat = chats.find(c => c.id === targetId);
        if (!existingChat) {
            const target = users.find(u => u.id === targetId);
            if (!target) return socket.emit('chat:error', 'Пользователь не найден');
            if (userId === targetId) return socket.emit('chat:error', 'Нельзя чатиться с собой');
            
            const common = chatMembers.find(m1 => m1.user_id === userId && chatMembers.some(m2 => m2.chat_id === m1.chat_id && m2.user_id === targetId));
            if (common) { existingChat = chats.find(c => c.id === common.chat_id); } 
            else {
                const chatId = 'chat_' + Date.now(); existingChat = { id: chatId, name: target.username, is_group: 0 };
                chats.push(existingChat); chatMembers.push({ chat_id: chatId, user_id: userId }, { chat_id: chatId, user_id: targetId });
                io.to(targetId).emit('chat:new', existingChat);
            }
        }
        socket.join(existingChat.id);
        socket.emit('chat:opened', { chatId: existingChat.id, messages: messages.filter(m => m.chat_id === existingChat.id) });
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
        const { chatId, senderId, senderName, text } = data;
        const msg = { id: 'msg_' + Date.now(), chatId, senderId, senderName, text, timestamp: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}) };
        messages.push(msg); io.to(chatId).emit('message:new', msg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { console.log(`Сервер Ink chat запущен на порту ${PORT}`); });
