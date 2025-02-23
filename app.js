const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode'); 
const userId = tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 'test_user';

// Устанавливаем WebSocket-соединение с нашим сервером на Railway
const WEBSOCKET_URL = "wss://websocket-production-3524.up.railway.app";
const socket = new WebSocket(WEBSOCKET_URL);

// Обработчики для WebSocket
socket.onopen = () => {
  console.log("✅ WebSocket connected");
  // Регистрируем пользователя при подключении
  socket.send(JSON.stringify({
    type: "register",
    user_id: userId,
    mode: mode || "viewer"
  }));
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("📩 Received message from server:", data);

  if (data.type === "stream_notification") {
    updateStreamList(data.user_id, data.mode);
  } else if (data.type === "stream_list") {
    renderStreamList(data.streams);
  } else if (data.type === "partner") {
    chatContainer.innerHTML += `<div class="chat-message"><b>Собеседник найден:</b> ${data.partner_id}</div>`;
  } else if (data.type === "chat_message") {
    appendMessage(data.user_id, data.message);
  } else if (data.type === "gift") {
    appendMessage("Бот", `🎁 Вы получили подарок на ${data.amount}`);
  }
};

socket.onerror = (error) => {
  console.error("❌ WebSocket error:", error);
};

socket.onclose = () => {
  console.log("❌ WebSocket closed");
};

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

let localStream;

if (!mode) {
  modeSelectionDiv.classList.remove('hidden');
} else {
  startApp(mode).catch(error => console.error("❌ Error in startApp:", error));
}

startModeBtn.addEventListener('click', () => {
  const selectedRadio = document.querySelector('input[name="mode"]:checked');
  if (!selectedRadio) {
    alert("Пожалуйста, выберите режим.");
    return;
  }
  const selectedMode = selectedRadio.value;
  startApp(selectedMode).catch(error => console.error("❌ Error in startApp:", error));
});

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
      chatContainer.innerHTML = `<div class="chat-message"><i>📡 Ваш эфир запущен!</i></div>`;
      giftBtn.classList.add('hidden');
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "start_stream",
            user_id: userId,
            mode: mode
          }));
        }
      }, 1000);
    } else if (mode === 'roulette') {
      chatContainer.innerHTML = `<div class="chat-message"><i>🔄 Поиск собеседника...</i></div>`;
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
    localVideo.srcObject = localStream;
    await localVideo.play();
    console.log("📷 Video stream started successfully");
    return true;
  } catch (error) {
    console.error("🚨 Ошибка доступа к камере/микрофону:", error);
    chatContainer.innerHTML += `<div class="chat-message"><b>Ошибка:</b> ${error.message}</div>`;
    alert("🚨 Не удалось получить доступ к камере/микрофону. Проверьте разрешения.");
    return false;
  }
}

function renderStreamList(streams) {
  if (streams.length === 0) {
    streamList.innerHTML = '<div class="stream-item"><h3>Нет активных эфиров</h3></div>';
  } else {
    streamList.innerHTML = streams.map(sid =>
      `<div class="stream-item" onclick="joinStream('${sid}')"><h3>Эфир от ${sid}</h3><p>Нажмите, чтобы присоединиться</p></div>`
    ).join('');
  }
}

function joinStream(streamerId) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "join_stream",
      user_id: userId,
      streamer_id: streamerId
    }));
  }
  appContainerDiv.classList.remove('hidden');
  viewerContainer.classList.add('hidden');
  modeTitle.innerText = "Просмотр эфира";
  chatContainer.innerHTML = `<div class="chat-message"><i>Вы присоединились к эфиру от ${streamerId}</i></div>`;
}

function getModeTitle(m) {
  if (m === 'stream') return "📡 Эфир";
  if (m === 'roulette') return "🎥 Видео-рулетка";
  if (m === 'viewer') return "👀 Зритель";
  return "🔄 Неизвестный режим";
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
      to: userId, 
      amount: giftAmount
    }));
  }
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div class="chat-message"><b>${sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

tg.onEvent('data', (data) => {
  console.log('📩 Received data from bot:', data);
  if (data.event === 'gift') {
    appendMessage("Бот", `🎁 Вы получили подарок на ${data.amount}`);
  }
});
