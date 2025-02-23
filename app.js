const tg = window.Telegram.WebApp;
tg.expand();
console.log("Telegram initData:", tg.initData);

const urlParams = new URLSearchParams(window.location.search);
let mode = urlParams.get('mode');
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

if (!mode) {
  modeSelectionDiv.classList.remove('hidden');
} else {
  startApp(mode).catch(error => console.error("Error in startApp:", error));
}

startModeBtn.addEventListener('click', () => {
  const selectedMode = document.querySelector('input[name="mode"]:checked').value;
  startApp(selectedMode).catch(error => console.error("Error in startApp:", error));
});

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
      chatContainer.innerHTML = `<div class="chat-message"><i>Ваш эфир запущен 🔥</i></div>`;
      giftBtn.classList.add('hidden'); // Ведущий не отправляет подарки самому себе
    } else if (mode === 'roulette') {
      chatContainer.innerHTML = `<div class="chat-message"><i>Поиск собеседника...</i></div>`;
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

async function fetchStreams() {
  // Временная заглушка, так как WebSocket отключён
  streamList.innerHTML = '<div class="stream-item"><h3>Нет активных эфиров</h3></div>';
}

function updateStreamList(streamerId, mode) {
  // Временная заглушка, так как WebSocket отключён
  streamList.innerHTML = `<div class="stream-item"><h3>Эфир ${mode === 'stream_18' ? '(18+)' : ''} от ${streamerId}</h3><p>Нажми, чтобы присоединиться 👀</p></div>`;
}

function getModeTitle(m) {
  return m === 'stream' ? "Эфир 🔥" : m === 'roulette' ? "Видео-рулетка 🎉" : "Эфир (зритель) 👀";
}

sendMsgBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  appendMessage("Вы", msg);
  chatInput.value = "";
  // Временная заглушка для чата без WebSocket
  chatContainer.innerHTML += `<div class="chat-message"><b>Вы:</b> ${msg}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
});

giftBtn.addEventListener('click', () => {
  const giftAmount = 1.0; // Фиксированная сумма подарка (заглушка)
  chatContainer.innerHTML += `<div class="chat-message"><b>Вы:</b> Отправили подарок на ${giftAmount} 🎁</div>`;
});

function appendMessage(sender, message) {
  chatContainer.innerHTML += `<div class="chat-message"><b>${sender}:</b> ${message}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

tg.onEvent('data', (data) => {
  console.log('Received data from bot:', data);
  if (data.event === 'gift') {
    chatContainer.innerHTML += `<div class="chat-message"><b>Бот:</b> Вы получили подарок на ${data.amount} 🎁</div>`;
  }
});
