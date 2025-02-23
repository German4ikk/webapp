const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode') || 'stream'; // По умолчанию эфир
const userId = tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 'test_user';

const modeSelectionDiv = document.getElementById('modeSelection');
const startModeBtn = document.getElementById('startModeBtn');
const appContainerDiv = document.getElementById('appContainer');
const modeTitle = document.getElementById('modeTitle');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chatContainer = document.getElementById('chatContainer');
const chatInput = document.getElementById('chatInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');

let localStream;
let peerConnection;
const ws = new WebSocket('wss://your-signaling-server.com:5000'); // Замените на реальный сервер

if (!mode) {
  modeSelectionDiv.classList.remove('hidden');
} else {
  startApp(mode);
}

startModeBtn.addEventListener('click', () => {
  const selectedMode = document.querySelector('input[name="mode"]:checked').value;
  startApp(selectedMode);
});

ws.onopen = () => {
  console.log('Connected to signaling server');
  ws.send(JSON.stringify({ type: 'register', user_id: userId, mode: mode }));
};

ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'offer') {
    await handleOffer(data);
  } else if (data.type === 'answer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.type === 'candidate') {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } else if (data.type === 'partner') {
    await startRoulette(data.partner_id);
  } else if (data.type === 'stream_started') {
    chatContainer.innerHTML = `<i>Ваш эфир запущен!</i><br>`;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  chatContainer.innerHTML += `<div><b>Ошибка:</b> Проблема с подключением к серверу. Проверьте настройки.</div>`;
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
  chatContainer.innerHTML += `<div><b>Предупреждение:</b> Соединение с сервером потеряно.</div>`;
};

async function startApp(selectedMode) {
  mode = selectedMode;
  modeSelectionDiv.classList.add('hidden');
  appContainerDiv.classList.remove('hidden');
  modeTitle.innerText = getModeTitle(mode);

  await startVideo();

  if (mode === 'stream') {
    ws.send(JSON.stringify({ type: 'start_stream', user_id: userId }));
  } else if (mode === 'roulette') {
    ws.send(JSON.stringify({ type: 'join_roulette', user_id: userId }));
  }
}

async function startVideo() {
  try {
    const constraints = { video: { width: 1280, height: 720 }, audio: true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    localVideo.play();
    console.log("Video stream started successfully");
  } catch (error) {
    console.error("Ошибка доступа к камере/микрофону:", error);
    chatContainer.innerHTML += `<div><b>Ошибка:</b> ${error.message}</div>`;
    alert("Не удалось получить доступ к камере/микрофону. Проверьте разрешения и попробуйте снова.");
  }
}

async function startRoulette(partnerId) {
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.classList.remove('hidden');
    chatContainer.innerHTML = "<i>Собеседник подключен!</i><br>";
  };

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, to: partnerId }));
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', offer: offer, to: partnerId }));
}

async function handleOffer(data) {
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.classList.remove('hidden');
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, to: data.from }));
      }
    };
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: 'answer', answer: answer, to: data.from }));
}

function getModeTitle(m) {
  return m === 'stream' ? "Эфир" : "Видео-рулетка";
}

sendMsgBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  appendMessage("Вы", msg);
  chatInput.value = "";
  ws.send(JSON.stringify({ type: 'chat_message', user_id: userId, message: msg }));
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div class="chat-message"><b>${sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Обработка данных от бота (если бот отправляет что-то)
tg.onEvent('data', (data) => {
  console.log('Received data from bot:', data);
  if (data.event === 'gift') {
    chatContainer.innerHTML += `<div class="chat-message"><b>Бот:</b> Вы получили подарок на ${data.amount}!</div>`;
  }
});
