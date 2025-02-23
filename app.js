const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode');
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
const ws = new WebSocket('wss://your-signaling-server.com:5000'); // Используйте WSS для HTTPS

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
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer: answer, to: data.from }));
  } else if (data.type === 'answer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.type === 'candidate') {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } else if (data.type === 'partner') {
    startRoulette(data.partner_id);
  }
};

async function startApp(selectedMode) {
  mode = selectedMode;
  modeSelectionDiv.classList.add('hidden');
  appContainerDiv.classList.remove('hidden');
  modeTitle.innerText = getModeTitle(mode);

  await startVideo();

  if (mode === 'stream') {
    chatContainer.innerHTML = "<i>Ваш эфир запущен!</i><br>";
  } else if (mode === 'roulette') {
    chatContainer.innerHTML = "<i>Поиск собеседника...</i><br>";
    ws.send(JSON.stringify({ type: 'join_roulette', user_id: userId }));
  }
}

async function startVideo() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (error) {
    console.error("Ошибка доступа к камере/микрофону:", error);
    chatContainer.innerHTML += `<div><b>Ошибка:</b> ${error.message}</div>`;
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

function getModeTitle(m) {
  return m === 'stream' ? "Эфир" : "Видео-рулетка";
}

sendMsgBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  appendMessage("Вы", msg);
  chatInput.value = "";
  // Здесь можно отправить сообщение через WebSocket
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div><b>${sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
