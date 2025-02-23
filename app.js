const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode') || 'stream';
const userId = tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 'test_user';

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
let peerConnection;
let streamerId = null; // Для зрителей — ID ведущего
const ws = new WebSocket('wss://your-signaling-server.com:5000'); // Замените на реальный сервер

if (!mode) {
  modeSelectionDiv.classList.remove('hidden');
} else {
  startApp(mode).catch(error => console.error("Error in startApp:", error));
}

startModeBtn.addEventListener('click', () => {
  const selectedMode = document.querySelector('input[name="mode"]:checked').value;
  startApp(selectedMode).catch(error => console.error("Error in startApp:", error));
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
    updateStreamList(data.user_id, data.mode || 'stream');
  } else if (data.type === 'stream_notification') {
    updateStreamList(data.user_id, data.mode || 'stream');
  } else if (data.type === 'viewer_joined') {
    chatContainer.innerHTML += `<div class="chat-message"><i>Новый зритель подключился 👀</i></div>`;
  } else if (data.type === 'chat_message') {
    appendMessage(data.user_id, data.message);
  } else if (data.type === 'gift') {
    appendMessage('Бот', `Вы получили подарок на ${data.amount} 🎁`);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  chatContainer.innerHTML += `<div class="chat-message"><b>Ошибка:</b> Проблема с подключением к серверу. Проверьте настройки.</div>`;
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
  chatContainer.innerHTML += `<div class="chat-message"><b>Предупреждение:</b> Соединение с сервером потеряно.</div>`;
};

async function startApp(selectedMode) {
  mode = selectedMode;
  modeSelectionDiv.classList.add('hidden');

  if (mode === 'viewer') {
    viewerContainer.classList.remove('hidden');
    loading.classList.remove('hidden');
    await fetchStreams();
    loading.classList.add('hidden');
  } else {
    viewerContainer.classList.add('hidden');
    appContainerDiv.classList.remove('hidden');
    modeTitle.innerText = getModeTitle(mode);

    const videoStarted = await startVideo();
    if (!videoStarted) return;

    if (mode === 'stream') {
      ws.send(JSON.stringify({ type: 'start_stream', user_id: userId }));
      giftBtn.classList.add('hidden'); // Ведущий не отправляет подарки самому себе
    } else if (mode === 'roulette') {
      ws.send(JSON.stringify({ type: 'join_roulette', user_id: userId }));
      giftBtn.classList.remove('hidden');
    }
  }
}

async function startVideo() {
  try {
    const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    localVideo.play();
    console.log("Video stream started successfully");
    return true;
  } catch (error) {
    console.error("Ошибка доступа к камере/микрофону:", error);
    chatContainer.innerHTML += `<div class="chat-message"><b>Ошибка:</b> ${error.message}. Проверьте разрешения в настройках браузера.</div>`;
    alert("Не удалось получить доступ к камере/микрофону. Проверьте разрешения и попробуйте снова.");
    return false;
  }
}

async function startRoulette(partnerId) {
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:turn.bistri.com:80', username: 'homeo', credential: 'homeo' }] });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.classList.remove('hidden');
    chatContainer.innerHTML += `<div class="chat-message"><i>Собеседник подключен 🎉</i></div>`;
    giftBtn.classList.remove('hidden');
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
    peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:turn.bistri.com:80', username: 'homeo', credential: 'homeo' }] });
    if (mode === 'viewer') {
      peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.classList.remove('hidden');
        chatContainer.innerHTML += `<div class="chat-message"><i>Вы подключены к эфиру как зритель 👀</i></div>`;
        giftBtn.classList.remove('hidden');
      };
    } else {
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
      peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.classList.remove('hidden');
      };
    }

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, to: data.from }));
      }
    };
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
  if (mode !== 'viewer') {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer: answer, to: data.from }));
  }
}

async function fetchStreams() {
  ws.send(JSON.stringify({ type: 'get_streams', user_id: userId }));
  streamList.innerHTML = '<div class="stream-item"><h3>Нет активных эфиров</h3></div>';
}

function updateStreamList(streamerId, mode) {
  const streamItem = document.createElement('div');
  streamItem.className = 'stream-item';
  streamItem.innerHTML = `
    <h3>Эфир ${mode === 'stream_18' ? '(18+)' : ''} от ${streamerId}</h3>
    <p>Нажми, чтобы присоединиться 👀</p>
  `;
  streamItem.onclick = () => joinStream(streamerId);
  streamList.innerHTML = '';
  streamList.appendChild(streamItem);
}

async function joinStream(streamerId) {
  mode = 'viewer';
  viewerContainer.classList.add('hidden');
  appContainerDiv.classList.remove('hidden');
  modeTitle.innerText = "Эфир (зритель) 👀";
  this.streamerId = streamerId;
  ws.send(JSON.stringify({ type: 'join_stream', user_id: userId, streamer_id: streamerId }));
  giftBtn.classList.remove('hidden');
}

function getModeTitle(m) {
  return m === 'stream' ? "Эфир 🔥" : m === 'roulette' ? "Видео-рулетка 🎉" : "Эфир (зритель) 👀";
}

sendMsgBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  appendMessage("Вы", msg);
  chatInput.value = "";
  if (mode === 'viewer') {
    ws.send(JSON.stringify({ type: 'chat_message', user_id: userId, message: msg, to: streamerId }));
  } else {
    ws.send(JSON.stringify({ type: 'chat_message', user_id: userId, message: msg }));
  }
});

giftBtn.addEventListener('click', () => {
  const giftAmount = 1.0; // Фиксированная сумма подарка (можно сделать выбор)
  ws.send(JSON.stringify({ type: 'gift', user_id: userId, to: streamerId, amount: giftAmount }));
  chatContainer.innerHTML += `<div class="chat-message"><b>Вы:</b> Отправили подарок на ${giftAmount} 🎁</div>`;
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div class="chat-message"><b>${sender === userId ? 'Вы' : sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

tg.onEvent('data', (data) => {
  console.log('Received data from bot:', data);
  if (data.event === 'gift') {
    chatContainer.innerHTML += `<div class="chat-message"><b>Бот:</b> Вы получили подарок на ${data.amount} 🎁</div>`;
  }
});
