const tg = window.Telegram.WebApp;
tg.expand();

// 1. Безопасность: экранирование HTML
const escapeHTML = str => str.replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 2. Инициализация WebSocket с переподключением
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
let socket;
let reconnectAttempts = 0;

const initWebSocket = () => {
  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("✅ Соединение установлено");
    reconnectAttempts = 0;
    registerUser();
  };

  socket.onmessage = handleMessage;
  
  socket.onclose = () => {
    console.log("🔌 Соединение закрыто");
    reconnect();
  };

  socket.onerror = (err) => {
    console.error("⚠️ Ошибка WebSocket:", err);
    socket.close();
  };
};

// 3. Регистрация пользователя
const registerUser = () => {
  const userId = tg.initDataUnsafe.user?.id || 'guest_' + Math.random().toString(36).substr(2, 9);
  const mode = new URLSearchParams(window.location.search).get('mode') || 'viewer';
  
  socket.send(JSON.stringify({
    type: "register",
    user_id: escapeHTML(userId),
    mode: escapeHTML(mode)
  }));
};

// 4. Обработчик сообщений
const handleMessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("📥 Получено:", data.type);

    switch(data.type) {
      case 'stream_list':
        renderStreams(data.streams);
        break;
      case 'offer':
        await handleWebRTCOffer(data);
        break;
      case 'chat_message':
        showChatMessage(data.sender, data.message);
        break;
      default:
        console.warn("Неизвестный тип сообщения:", data.type);
    }
  } catch (err) {
    console.error("Ошибка обработки сообщения:", err);
  }
};

// 5. WebRTC логика
let peerConnection;

const initPeerConnection = () => {
  if (peerConnection) peerConnection.close();
  
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // Добавьте TURN-серверы при необходимости
    ]
  });

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send(JSON.stringify({
        type: "ice_candidate",
        candidate: candidate.toJSON()
      }));
    }
  };
};

// 6. Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  setupUIEventListeners();
});

// 7. Вспомогательные функции
const reconnect = () => {
  if (reconnectAttempts < 5) {
    const delay = Math.min(3000 * (2 ** reconnectAttempts), 30000);
    console.log(`♻️ Переподключение через ${delay}ms...`);
    setTimeout(initWebSocket, delay);
    reconnectAttempts++;
  }
};

const showChatMessage = (sender, message) => {
  const chat = document.getElementById('chatContainer');
  const div = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <b>${escapeHTML(sender)}</b>: 
    <span>${escapeHTML(message)}</span>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
};

// 8. Очистка при закрытии
window.addEventListener('beforeunload', () => {
  socket?.close();
  peerConnection?.close();
  localStream?.getTracks().forEach(track => track.stop());
});
