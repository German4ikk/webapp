const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

// Получаем userId из initData (если доступен) или генерируем случайный
const userId = tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : Math.random().toString(36).substr(2, 9);
let mode = null; // Сбрасываем mode, чтобы всегда показывать выбор режима

// WebSocket URL для подключения к серверу
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
let socket;
let reconnectTimer;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

let peerConnection;
let localStream;

// DOM-элементы
const modeSelectionDiv = document.getElementById('modeSelection');
const startModeBtn = document.getElementById('startModeBtn');
const viewerContainer = document.getElementById('viewerContainer');
const streamList = document.getElementById('streamList');
const loading = document.getElementById('loading');
const appContainerDiv = document.getElementById('appContainer');
const modeTitle = document.getElementById('modeTitle');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chatContainer = document.getElementById('chatContainer');
const chatInput = document.getElementById('chatInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const giftBtn = document.getElementById('giftBtn');
const errorMessage = document.getElementById('errorMessage');

// WebSocket с переподключением
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
    if (mode) registerUser();
  };

  socket.onmessage = handleMessage;

  socket.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
  };

  socket.onclose = () => {
    console.log("🔌 WebSocket connection closed");
    reconnectAttempts++;
    reconnectTimer = setTimeout(initWebSocket, 5000 * reconnectAttempts);
  };
};

function registerUser() {
  socket.send(JSON.stringify({
    type: "register",
    user_id: userId,
    mode: mode || "viewer"
  }));
}

const handleMessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("📥 Received:", data.type);

    switch (data.type) {
      case 'connected':
        console.log("Успешно подключено к серверу");
        if (mode === 'viewer') {
          socket.send(JSON.stringify({ type: "get_streams", user_id: userId }));
        } else if (mode === 'stream') {
          startStream();
        } else if (mode === 'roulette') {
          handleRoulette();
        }
        break;
      case 'stream_list':
        renderStreamList(data.streams || []);
        break;
      case 'stream_started':
      case 'stream_notification':
        updateStreamList(data.user_id, data.mode);
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
      case 'chat_message':
        appendMessage(data.user_id, data.message);
        break;
      case 'gift':
        appendMessage("Бот", `🎁 Вы получили подарок на ${data.amount}`);
        break;
      case 'error':
        showError(data.message || "Произошла ошибка на сервере");
        break;
      case 'viewer_joined':
        console.log(`Зритель ${data.viewer_id} подключился к вашему эфиру`);
        break;
    }
  } catch (error) {
    console.error("Ошибка обработки сообщения:", error);
    showError("Ошибка при обработке серверного сообщения");
  }
};

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
    await createPeerConnection();
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

async function startApp(selectedMode) {
  mode = selectedMode;
  modeSelectionDiv.classList.add('hidden');

  if (mode === 'viewer') {
    viewerContainer.classList.remove('hidden');
    loading.classList.remove('hidden');
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "get_streams", user_id: userId }));
    }
    loading.classList.add('hidden');
  } else {
    viewerContainer.classList.add('hidden');
    appContainerDiv.classList.remove('hidden');
    modeTitle.innerText = getModeTitle(mode);

    const videoStarted = await startVideo();
    if (!videoStarted) return;

    if (mode === 'stream') {
      chatContainer.innerHTML = '<div class="chat-message"><i>📡 Ваш эфир запущен!</i></div>';
      giftBtn.classList.add('hidden');
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "start_stream",
          user_id: userId,
          mode: mode
        }));
      }
    } else if (mode === 'roulette') {
      chatContainer.innerHTML = '<div class="chat-message"><i>🔄 Поиск собеседника...</i></div>';
      giftBtn.classList.remove('hidden');
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "join_roulette",
          user_id: userId
        }));
      }
    }
  }
}

async function startVideo() {
  try {
    const constraints = { 
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: true 
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (localVideo) {
      localVideo.srcObject = localStream;
      await localVideo.play();
    }
    console.log("📷 Video stream started successfully");
    return true;
  } catch (error) {
    console.error("🚨 Ошибка доступа к камере/микрофону:", error);
    chatContainer.innerHTML += `<div class="chat-message"><b>Ошибка:</b> ${error.message}</div>`;
    showError("Не удалось получить доступ к камере или микрофону");
    return false;
  }
}

function renderStreamList(streams) {
  if (!streamList) return;
  if (streams.length === 0) {
    streamList.innerHTML = '<div class="stream-item"><h3>Нет активных эфиров</h3></div>';
  } else {
    streamList.innerHTML = streams.map(sid => `
      <div class="stream-item" onclick="joinStream('${sid}')">
        <h3>🎥 Эфир от ${sid}</h3>
        <p>Нажмите, чтобы присоединиться</p>
      </div>
    `).join('');
  }
}

function joinStream(streamerId) {
  if (socket.readyState !== WebSocket.OPEN) {
    showError("Нет активного соединения с сервером");
    return;
  }
  createPeerConnection().then(() => {
    peerConnection.createOffer().then(offer => {
      peerConnection.setLocalDescription(offer).then(() => {
        socket.send(JSON.stringify({
          type: "join_stream",
          user_id: userId,
          streamer_id: streamerId
        }));
      });
    });
  });
  appContainerDiv.classList.remove('hidden');
  viewerContainer.classList.add('hidden');
  modeTitle.innerText = "Просмотр эфира";
  chatContainer.innerHTML = `<div class="chat-message"><i>Вы присоединились к эфиру от ${streamerId}</i></div>`;
}

function handleRoulette() {
  if (socket.readyState !== WebSocket.OPEN) {
    showError("Нет активного соединения с сервером");
    return;
  }
  createPeerConnection().then(() => {
    peerConnection.createOffer().then(offer => {
      peerConnection.setLocalDescription(offer).then(() => {
        socket.send(JSON.stringify({
          type: "join_roulette",
          user_id: userId
        }));
      });
    });
  });
  chatContainer.innerHTML = '<div class="chat-message"><i>🔄 Поиск собеседника...</i></div>';
  giftBtn.classList.remove('hidden');
}

function startStream() {
  if (socket.readyState !== WebSocket.OPEN) {
    showError("Нет активного соединения с сервером");
    return;
  }
  socket.send(JSON.stringify({
    type: "start_stream",
    user_id: userId,
    mode: "stream"
  }));
  chatContainer.innerHTML = '<div class="chat-message"><i>📡 Ваш эфир запущен!</i></div>';
  giftBtn.classList.add('hidden');
}

function getModeTitle(m) {
  switch (m) {
    case 'stream': return "📡 Эфир";
    case 'roulette': return "🎥 Видео-рулетка";
    case 'viewer': return "👀 Зритель";
    default: return "🔄 Неизвестный режим";
  }
}

sendMsgBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  appendMessage("Вы", msg);
  chatInput.value = "";
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "chat_message",
      user_id: userId,
      message: msg
    }));
  }
});

giftBtn.addEventListener('click', () => {
  const giftAmount = 1.0;
  appendMessage("Вы", `🎁 Отправили подарок на ${giftAmount}`);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "gift",
      user_id: userId,
      to: userId, // Здесь можно указать другого пользователя (например, стримера)
      amount: giftAmount
    }));
  }
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div class="chat-message"><b>${sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showError(message) {
  if (errorMessage) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 5000);
  }
  console.error("Error:", message);
}

function updateStreamList(userId, mode) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "get_streams", user_id: userId }));
  }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  setupEventListeners();

  // Показываем меню выбора режима, если mode не указан
  const urlParams = new URLSearchParams(window.location.search);
  mode = urlParams.get('mode');
  if (!mode || !['viewer', 'stream', 'roulette'].includes(mode)) {
    modeSelectionDiv.classList.remove('hidden');
  } else {
    startApp(mode).catch(error => console.error("❌ Error in startApp:", error));
  }
});

function setupEventListeners() {
  startModeBtn?.addEventListener('click', () => {
    const selectedRadio = document.querySelector('input[name="mode"]:checked');
    if (!selectedRadio) {
      showError("Пожалуйста, выберите режим.");
      return;
    }
    const selectedMode = selectedRadio.value;
    startApp(selectedMode).catch(error => console.error("❌ Error in startApp:", error));
  });

  document.getElementById('startRouletteBtn')?.addEventListener('click', handleRoulette);
  document.getElementById('startStreamBtn')?.addEventListener('click', startStream);
}
