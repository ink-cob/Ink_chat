// Подключаемся к сокетам
const socket = typeof io !== 'undefined' ? io() : null;
if (!socket) {
    console.error("Критическая ошибка: библиотека Socket.io не загрузилась!");
}

let currentUser = null;
let activeChatId = null;

// Защищенная функция для получения элементов (чтобы код не падал, если элемента нет)
const getEl = (id) => document.getElementById(id);

// Ожидаем полную загрузку страницы, чтобы элементы точно существовали в памяти
window.addEventListener('DOMContentLoaded', () => {
    console.log("Ink chat фронтенд успешно запущен!");

    // Проверяем кнопки авторизации
    if (getEl('btn-login')) {
        getEl('btn-login').addEventListener('click', async () => {
            const username = getEl('auth-username').value.trim();
            const password = getEl('auth-password').value;
            if(!username || !password) return alert('Заполните никнейм и пароль');
            
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.error) { 
                getEl('auth-error').innerText = data.error; 
                getEl('auth-error').style.display = 'block'; 
            } else { 
                loginSuccess(data); 
            }
        });
    }

    if (getEl('btn-register')) {
        getEl('btn-register').addEventListener('click', async () => {
            const username = getEl('auth-username').value.trim();
            const password = getEl('auth-password').value;
            if(!username || !password) return alert('Заполните никнейм и пароль');
            
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.error) { 
                getEl('auth-error').innerText = data.error; 
                getEl('auth-error').style.display = 'block'; 
            } else { 
                loginSuccess(data); 
            }
        });
    }

    function loginSuccess(user) {
        currentUser = user;
        getEl('auth-screen').classList.remove('active');
        getEl('app-screen').classList.add('active');
        if (socket) socket.emit('user:join', user.id);
    }

    // Логика чатов и кнопок внутри приложения
    if (getEl('btn-action-add')) {
        getEl('btn-action-add').addEventListener('click', () => {
            const query = getEl('search-friend-id').value.trim();
            if (!query) return alert('Введите 10-значный ID или имя группы');
            if (query.length === 10 && /^\d+$/.test(query)) {
                if (socket) socket.emit('chat:create_private', { userId: currentUser.id, targetId: query });
            } else {
                if (socket) socket.emit('chat:create_group', { userId: currentUser.id, groupName: query });
            }
            getEl('search-friend-id').value = '';
        });
    }

    if (getEl('btn-send-message')) {
        getEl('btn-send-message').addEventListener('click', sendMessage);
    }
    if (getEl('message-text-input')) {
        getEl('message-text-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    }

    function sendMessage() {
        const input = getEl('message-text-input');
        const text = input.value.trim();
        if (!text || !activeChatId) return;
        if (socket) socket.emit('message:send', { chatId: activeChatId, senderId: currentUser.id, senderName: currentUser.username, text });
        input.value = '';
    }

    if (getEl('file-input')) {
        getEl('file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0]; // Исправлено для корректного выбора одного файла
            if (!file || !activeChatId) return;
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.fileUrl && socket) {
                socket.emit('message:send', { chatId: activeChatId, senderId: currentUser.id, senderName: currentUser.username, fileUrl: data.fileUrl, fileName: data.fileName, fileType: data.fileType });
            }
        });
    }

    if (getEl('btn-menu')) {
        getEl('btn-menu').addEventListener('click', () => {
            getEl('prof-id').innerText = currentUser.id;
            getEl('prof-date').innerText = currentUser.created_at;
            getEl('modal-settings').classList.add('active');
        });
    }
    if (getEl('btn-close-settings')) {
        getEl('btn-close-settings').addEventListener('click', () => {
            getEl('modal-settings').classList.remove('active'); // Исправлена опечатка (.remove -> .active)
        });
    }

    if (getEl('btn-save-profile')) {
        getEl('btn-save-profile').addEventListener('click', () => {
            const newUsername = getEl('settings-username').value.trim();
            const newPassword = getEl('settings-password').value.trim();
            if (socket) socket.emit('profile:update', { userId: currentUser.id, newUsername: newUsername || null, newPassword: newPassword || null });
        });
    }

    if (getEl('btn-delete-account')) {
        getEl('btn-delete-account').addEventListener('click', () => {
            if (confirm('Удалить аккаунт?')) { if (socket) socket.emit('profile:delete', currentUser.id); }
        });
    }

    // Слушатели ответов от сервера сокетов
    if (socket) {
        socket.on('user:chats', (chats) => {
            const container = getEl('chats-container');
            if (!container) return;
            container.innerHTML = '';
            chats.forEach(chat => {
                const item = document.createElement('div');
                item.className = `chat-item ${chat.id === activeChatId ? 'active' : ''}`;
                item.innerHTML = `
                    <div class="avatar">${chat.name.substring(0, 2).toUpperCase()}</div>
                    <div style="flex:1;">
                        <h4>${chat.name}</h4>
                        <p style="font-size:12px; color:gray;">${chat.is_group ? 'Группа' : 'Чат 1-на-1'}</p>
                    </div>
                `;
                item.onclick = () => openChat(chat.id, chat.name);
                container.appendChild(item);
            });
        });

        socket.on('chat:new', () => socket.emit('user:join', currentUser.id));
        socket.on('chat:error', (err) => alert(err));

        socket.on('chat:opened', ({ chatId, messages }) => {
            if (chatId !== activeChatId) return;
            const container = getEl('messages-container');
            if (!container) return;
            container.innerHTML = '';
            messages.forEach(msg => displayMessage(msg));
            container.scrollTop = container.scrollHeight;
        });

        socket.on('message:new', (msg) => {
            if (msg.chatId === activeChatId) { 
                displayMessage(msg); 
                const container = getEl('messages-container');
                if (container) container.scrollTop = container.scrollHeight; 
            }
        });

        socket.on('message:deleted', ({ msgId }) => { const el = getEl(`msg-${msgId}`); if (el) el.remove(); });
        
        socket.on('profile:updated', (res) => {
            if (res.success) { currentUser.username = res.user.username; alert('Успешно изменено!'); getEl('modal-settings').classList.remove('active'); } 
            else { alert(res.error); }
        });
        
        socket.on('profile:deleted', () => { alert('Удалено.'); window.location.reload(); });
    }
});

function openChat(chatId, chatName) {
    activeChatId = chatId;
    getEl('chat-stub').classList.remove('active');
    getEl('chat-active').classList.add('active');
    getEl('active-chat-name').innerText = chatName;
    getEl('active-chat-avatar').innerText = chatName.substring(0, 2).toUpperCase();
    if (socket) socket.emit('chat:create_private', { userId: currentUser.id, targetId: chatId.includes('chat_') || chatId.includes('group_') ? '' : chatId });
}

function displayMessage(msg) {
    const isMy = msg.sender_id === currentUser.id;
    const row = document.createElement('div');
    row.className = `msg-row ${isMy ? 'my' : 'other'}`;
    row.id = `msg-${msg.id}`;
    let content = ``;
    if (!isMy) content += `<div class="msg-author">${msg.sender_name}</div>`;
    if (msg.file_url) {
        if (msg.file_type && msg.file_type.startsWith('image/')) {
            content += `<img src="${msg.file_url}" style="max-width:100%; border-radius:8px;"><br>`;
        } else {
            content += `<a href="${msg.file_url}" target="_blank"><i class="fa-file"></i> ${msg.file_name}</a><br>`;
        }
    }
    if (msg.text) content += `<span>${msg.text}</span>`;
    content += `<span class="msg-time">${msg.timestamp}</span>`;
    row.innerHTML = `<div class="msg-bubble">${content}</div>`;
    
    if (isMy) {
        row.ondblclick = () => {
            if (confirm('Удалить сообщение?')) { if (socket) socket.emit('message:delete', { msgId: msg.id, chatId: activeChatId }); }
        };
    }
    const container = getEl('messages-container');
    if (container) container.appendChild(row);
}
