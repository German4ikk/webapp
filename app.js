const tg = window.Telegram.WebApp;
tg.expand();

// 1. Исправление синтаксических ошибок в строках (исправлен escapeHTML)
const escapeHTML = (str) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 2. Конфигурация WebRTC (добавлены дополнительные STUN-серверы для надёжности)
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

let peerConnection;
let localStream;
let userId = Math.random().toString(36).substr(2, 9); // Генерируем уникальный userId
let socket;
let reconnectTimer;

// DOM-элементы (предполагается, что они существуют в HTML)
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const streamList = document.getElementById('streamList');

// 3. Улучшенное WebSocket соединение с переподключением и обработкой ошибок
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

const initWebSocket = () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("Превышено максимальное число попыток переподключения");
    showError("Не удалось подключиться к серверу. Попробуйте позже.");
    return;
  }

  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("✅ WebSocket connected");
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    registerUser();
  };

  socket.onmessage = handleMessage;

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  socket.onclose = () => {
    console.log("🔌 WebSocket connection closed");
    reconnectAttempts++;
    reconnectTimer = setTimeout(initWebSocket, 5000 * reconnectAttempts);
  };
};

// 4. Полный цикл WebRTC с улучшенной обработкой
const createPeerConnection = async () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  peerConnection = new RTCPeerConnection(ICE_CONFIG);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send(JSON.stringify({
        type: "ice_candidate",
        candidate: candidate.toJSON(),
        user_id: userId
      }));
    }
  };

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(e => console.error("Ошибка воспроизведения видео:", e));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      showError("Проблемы с соединением. Попробуйте переподключиться.");
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }
};

// 5. Исправленная и безопасная функция отображения эфиров
function renderStreamList(streams) {
  if (!streamList) return;
  streamList.innerHTML = streams.map(sid => `
    <div class="stream-item" onclick="joinStream('${escapeHTML(sid)}')">
      <h3>🎥 Эфир от ${escapeHTML(sid)}</h3>
      <p>Нажмите для подключения</p>
    </div>
  `).join('');
}

// 6. Обработка рулетки с таймаутом
async function handleRoulette() {
  try {
    await createPeerConnection();
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
      type: "join_roulette",
      user_id: userId
    }));

    // Таймаут на случай, если партнёр не найдён
    const timeout = setTimeout(() => {
      if (!peerConnection.remoteDescription) {
        showError("Не удалось найти собеседника. Попробуйте снова.");
        peerConnection.close();
      }
    }, 15000); // 15 секунд ожидания

    socket.send(JSON.stringify({
      type: "roulette_offer",
      offer: offer,
      user_id: userId
    }));
  } catch (error) {
    console.error("Ошибка в рулетке:", error);
    showError("Ошибка при подключении к рулетке");
  }
}

// 7. Модифицированный обработчик сообщений с улучшенной обработкой ошибок
const handleMessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("📥 Received:", data.type);

    switch (data.type) {
      case 'stream_list':
        renderStreamList(data.streams || []);
        break;
      case 'partner':
        await handlePartner(data.partner_id);
        break;
      case 'offer':
        await handleOffer(data);
        break;
      case 'answer':
        await handleAnswer(data);
        break;
      case 'ice_candidate':
        await handleIceCandidate(data);
        break;
      case 'error':
        showError(data.message || "Произошла ошибка на сервере");
        break;
      case 'connected':
        console.log("Успешно подключено к серверу");
        break;
    }
  } catch (error) {
    console.error("Ошибка обработки сообщения:", error);
    showError("Ошибка при обработке серверного сообщения");
  }
};

// 8. Обработчики WebRTC
async function handleOffer(data) {
  try {
    await createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
      type: "answer",
      answer: answer,
      to: data.from,
      user_id: userId
    }));
  } catch (error) {
    console.error("Ошибка обработки offer:", error);
    showError("Ошибка при обработке предложения WebRTC");
  }
}

async function handleAnswer(data) {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } catch (error) {
    console.error("Ошибка обработки answer:", error);
    showError("Ошибка при обработке ответа WebRTC");
  }
}

async function handleIceCandidate(data) {
  try {
    if (data.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (error) {
    console.error("Ошибка обработки ICE кандидата:", error);
    showError("Ошибка при обработке ICE-кандидата");
  }
}

async function handlePartner(partnerId) {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
      type: "offer",
      offer: offer,
      to: partnerId,
      user_id: userId
    }));
  } catch (error) {
    console.error("Ошибка при подключении к партнёру:", error);
    showError("Ошибка при подключении к собеседнику");
  }
}

// 9. Инициализация при загрузке с проверками
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initWebSocket();
    setupEventListeners();
    await startVideo();
  } catch (error) {
    console.error("Ошибка при инициализации:", error);
    showError("Ошибка при запуске приложения");
  }
});

// 10. Дополнительные функции
async function startVideo() {
  try {
    const constraints = { 
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: true
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (localVideo) {
      localVideo.srcObject = localStream;
      await localVideo.play();
    }
    
    return true;
  } catch (error) {
    console.error("Camera error:", error);
    showError("Не удалось получить доступ к камере или микрофону");
    return false;
  }
}

async function joinStream(streamerId) {
  try {
    await createPeerConnection();
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
      type: "join_stream",
      user_id: userId,
      streamer_id: streamerId
    }));
  } catch (error) {
    console.error("Ошибка при подключении к эфиру:", error);
    showError("Ошибка при подключении к эфиру");
  }
}

function registerUser() {
  socket.send(JSON.stringify({
    type: "register",
    user_id: userId,
    mode: "viewer" // или "streamer" в зависимости от режима
  }));
}

function setupEventListeners() {
  // Здесь добавь обработчики событий для интерфейса (например, кнопок)
  document.getElementById('startRouletteBtn')?.addEventListener('click', handleRoulette);
  document.getElementById('startStreamBtn')?.addEventListener('click', () => {
    socket.send(JSON.stringify({
      type: "start_stream",
      user_id: userId,
      mode: "stream"
    }));
  });
}

function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
  }
  console.error("Error:", message);
}
