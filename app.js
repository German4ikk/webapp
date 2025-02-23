const tg = window.Telegram.WebApp;
if (tg) {
  try {
    tg.expand();
    console.log("Telegram initData:", tg.initData);
  } catch (error) {
    console.error("Ошибка инициализации Telegram WebApp:", error);
  }
} else {
  console.error("Telegram WebApp не инициализирован");
}

// Получаем userId из initData (если доступен) или генерируем случайный
const userId = tg?.initDataUnsafe?.user ? tg.initDataUnsafe.user.id : Math.random().toString(36).substr(2, 9);
let mode = null; // Сбрасываем mode, чтобы всегда показывать выбор режима

// WebSocket URL для подключения к серверу
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
let socket;
let reconnectTimer;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;
let pingInterval; // Интервал для отправки пингов

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // Добавлен реальный TURN-сервер (замени на свои данные)
    { urls: "turn:your-turn-server.xirsys.com:3478", username: "your-username", credential: "your-password" }
  ]
};

let peerConnection;
let localStream;
let partnerId = null; // Храним ID партнёра в рулетке

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

// Проверка состояния WebSocket с интервалом
function checkWebSocket() {
  if (socket && socket.readyState === WebSocket.CLOSED) {
    console.warn("WebSocket закрыт, пытаемся переподключиться");
    initWebSocket();
  }
}

// Отправка пинга для поддержания активности
function sendPing() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ping' }));
    console.log("📡 Отправлен ping для поддержания активности WebSocket");
  } else {
    console.warn("WebSocket не открыт для отправки пинга");
  }
}

// WebSocket с переподключением
const initWebSocket = () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("Превышено максимальное число попыток переподключения");
    showError("Не удалось подключиться к серверу. Попробуйте позже.");
    return;
  }

  if (socket) {
    socket.close();
  }

  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("✅ WebSocket connected successfully");
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    if (mode) registerUser();
    // Начать проверку состояния каждые 5 секунд
    setInterval(checkWebSocket, 5000);
    // Начать отправку пингов каждые 20 секунд
    pingInterval = setInterval(sendPing, 20000);
  };

  socket.onmessage = handleMessage;

  socket.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
    showError("Ошибка WebSocket-соединения");
  };

  socket.onclose = (event) => {
    console.log("🔌 WebSocket connection closed, code:", event.code, "reason:", event.reason);
    clearInterval(pingInterval); // Остановить пинги при закрытии
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      initWebSocket();
      console.log(`Попытка переподключения #${reconnectAttempts}`);
    }, 5000 * reconnectAttempts);
  };
};

function registerUser() {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "register",
      user_id: userId,
      mode: mode || "viewer"
    }));
  } else {
    console.error("WebSocket не открыт для регистрации");
    showError("Не удалось зарегистрироваться — WebSocket закрыт");
    setTimeout(registerUser, 1000); // Пробуем снова через 1 секунду
  }
}

const handleMessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("📥 Received:", data.type);

    if (data.type === 'pong') {
      console.log("🏓 Получен pong от сервера");
      return; // Игнорируем pong, он только для поддержания активности
    }

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
        partnerId = data.partner_id; // Сохраняем ID партнёра
        await handlePartner(data.partner_id);
        break;
      case 'offer':
        await handleOffer(data);
        break;
      case 'answer':
        await handleAnswer(data);
        break;
      case 'candidate':
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
        appendMessage("Система", `Зритель ${data.viewer_id} подключился`);
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
    if (candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: candidate.toJSON(),
        user_id: userId,
        to: peerConnection.remoteUserId || partnerId || null // Для маршрутизации на сервере
      }));
    } else {
      console.error("WebSocket закрыт или нет кандидата ICE");
    }
  };

  peerConnection.ontrack = (event) => {
    console.log("Received track:", event);
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(e => console.error("Ошибка воспроизведения видео:", e));
    } else {
      console.warn("No streams in ontrack event:", event);
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
    peerConnection.remoteUserId = data.from; // Сохраняем ID удалённого пользователя
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "answer",
        answer: answer,
        to: data.from,
        user_id: userId
      }));
    } else {
      console.error("WebSocket закрыт при отправке answer");
      showError("Не удалось отправить ответ WebRTC — WebSocket закрыт");
    }
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
    peerConnection.remoteUserId = partnerId; // Сохраняем ID партнёра
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "offer",
        offer: offer,
        to: partnerId,
        user_id: userId
      }));
    } else {
      console.error("WebSocket закрыт при отправке offer для партнёра");
      showError("Не удалось отправить предложение WebRTC — WebSocket закрыт");
    }
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
    peerConnection.createOffer()
      .then(offer => {
        peerConnection.setLocalDescription(offer)
          .then(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "join_stream",
                user_id: userId,
                streamer_id: streamerId,
                offer: offer // Отправляем реальный offer
              }));
            } else {
              console.error("WebSocket закрыт при подключении к эфиру");
              showError("Не удалось подключиться к эфиру — WebSocket закрыт");
            }
          });
      })
      .catch(error => console.error("Ошибка создания offer:", error));
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
    peerConnection.createOffer()
      .then(offer => {
        peerConnection.setLocalDescription(offer)
          .then(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "join_roulette",
                user_id: userId,
                offer: offer // Отправляем реальный offer
              }));
            } else {
              console.error("WebSocket закрыт при подключении к рулетке");
              showError("Не удалось подключиться к рулетке — WebSocket закрыт");
            }
          });
      })
      .catch(error => console.error("Ошибка создания offer для рулетки:", error));
  });
  chatContainer.innerHTML = '<div class="chat-message"><i>🔄 Поиск собеседника...</i></div>';
  giftBtn.classList.remove('hidden');
}

function startStream() {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "start_stream",
      user_id: userId,
      mode: "stream"
    }));
    chatContainer.innerHTML = '<div class="chat-message"><i>📡 Ваш эфир запущен!</i></div>';
    giftBtn.classList.add('hidden');
  } else {
    console.error("WebSocket закрыт при запуске эфира");
    showError("Не удалось запустить эфир — WebSocket закрыт");
  }
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
    const to = mode === 'roulette' ? partnerId : (mode === 'viewer' ? peerConnection?.remoteUserId || null : null); // Для рулетки — партнёр, для зрителя — стример, для стримера — всем
    socket.send(JSON.stringify({
      type: "chat_message",
      user_id: userId,
      message: msg,
      to: to
    }));
  } else {
    console.error("WebSocket закрыт при отправке сообщения");
    showError("Не удалось отправить сообщение — WebSocket закрыт");
  }
});

giftBtn.addEventListener('click', () => {
  const giftAmount = 1.0;
  appendMessage("Вы", `🎁 Отправили подарок на ${giftAmount}`);
  if (socket.readyState === WebSocket.OPEN) {
    const to = mode === 'roulette' ? partnerId : (mode === 'viewer' ? peerConnection?.remoteUserId : userId);
    socket.send(JSON.stringify({
      type: "gift",
      user_id: userId,
      to: to,
      amount: giftAmount
    }));
  } else {
    console.error("WebSocket закрыт при отправке подарка");
    showError("Не удалось отправить подарок — WebSocket закрыт");
    // Попробовать переподключиться перед повторной отправкой
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "gift",
          user_id: userId,
          to: to,
          amount: giftAmount
        }));
      }
    }, 1000);
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
  } else {
    console.error("WebSocket закрыт при обновлении списка эфиров");
    showError("Не удалось обновить список эфиров — WebSocket закрыт");
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
