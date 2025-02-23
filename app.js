const tg = window.Telegram.WebApp;
tg.expand();

// 1. Безопасность: экранирование HTML
const escapeHTML = (str) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 2. Настройки WebRTC
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // Добавьте TURN-серверы при необходимости
  ]
};

// 3. Инициализация WebSocket с переподключением
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
let socket;
let reconnectTimeout;

function connectWebSocket() {
  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("✅ WebSocket connected");
    clearTimeout(reconnectTimeout);
    registerUser();
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    console.log("🔌 WebSocket closed");
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  };

  socket.onerror = (error) => {
    console.error("⚠️ WebSocket error:", error);
  };
}

// 4. Регистрация пользователя
function registerUser() {
  const userId = tg.initDataUnsafe.user?.id || 'guest_' + Math.random().toString(36).substr(2, 9);
  const mode = new URLSearchParams(window.location.search).get('mode') || 'viewer';
  
  socket.send(JSON.stringify({
    type: "register",
    user_id: escapeHTML(userId),
    mode: escapeHTML(mode)
  }));
}

// 5. Обработка входящих сообщений
function handleMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log("📥 Received:", data.type);

    switch(data.type) {
      case 'stream_list':
        renderStreamList(data.streams);
        break;
      case 'offer':
        handleWebRTCOffer(data);
        break;
      case 'answer':
        handleWebRTCAnswer(data);
        break;
      case 'candidate':
        handleICECandidate(data);
        break;
      case 'partner':
        handleRoulettePartner(data.partner_id);
        break;
      case 'error':
        showError(data.message);
        break;
    }
  } catch (error) {
    console.error("Ошибка обработки сообщения:", error);
  }
}

// 6. WebRTC логика
let peerConnection;

async function createPeerConnection() {
  if (peerConnection) peerConnection.close();
  
  peerConnection = new RTCPeerConnection(ICE_CONFIG);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: candidate.toJSON()
      }));
    }
  };

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };
}

// 7. Обработка предложения WebRTC
async function handleWebRTCOffer(data) {
  await createPeerConnection();
  
  // Добавление локального потока (для рулетки)
  if (mode === 'roulette') {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  await peerConnection.setRemoteDescription(data.offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: "answer",
    answer: answer,
    to: data.from
  }));
}

// 8. Присоединение к стриму
async function joinStream(streamerId) {
  await createPeerConnection();
  
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: "offer",
    offer: offer,
    to: streamerId
  }));
}

// 9. Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  setupEventListeners();
});

// 10. Дополнительные функции
function renderStreamList(streams) {
  streamList.innerHTML = streams.map(sid => `
    <div class="stream-item" onclick="joinStream('${escapeHTML(sid)}')">
      <h3>🎥 Эфир от ${escapeHTML(sid)}</h3>
      <p>Нажмите для подключения</p>
    </div>
  `).join('');
}

function handleRoulettePartner(partnerId) {
  chatContainer.innerHTML += `
    <div class="chat-message system">
      🎉 Найден собеседник: ${escapeHTML(partnerId)}
    </div>
  `;
  joinStream(partnerId);
}

// 11. Очистка ресурсов
window.addEventListener('beforeunload', () => {
  socket?.close();
  peerConnection?.close();
  localStream?.getTracks().forEach(track => track.stop());
});
