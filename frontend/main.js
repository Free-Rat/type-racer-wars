// import {
//   drawLobby,
//   drawCountdown,
//   drawRace,
//   drawResults
// } from './render.js';

const socket = new WebSocket("ws://localhost:3000/ws");

function encodeString(str) {
  const utf8 = new TextEncoder().encode(str);
  const buf = new Uint8Array(2 + utf8.length);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}

function decodeString(buf, offset) {
  const dv = new DataView(buf.buffer, buf.byteOffset + offset);
  const len = dv.getUint16(0, false);
  const strBytes = new Uint8Array(buf.buffer, buf.byteOffset + offset + 2, len);
  return [new TextDecoder().decode(strBytes), 2 + len];
}

socket.addEventListener('open', () => {
  console.log('[WS] open');
  // on reconnect attempt
  promptAndJoin(/* isReconnection = */ true);
});
socket.addEventListener('error', err => console.error('[WS] error', err));
socket.addEventListener('close', () => console.log('[WS] closed'));

socket.addEventListener('message', async event => {
  let buf;
  if (event.data instanceof Blob) {
    const arrayBuffer = await event.data.arrayBuffer();
    buf = new Uint8Array(arrayBuffer);
  } else if (event.data instanceof ArrayBuffer) {
    buf = new Uint8Array(event.data);
  } else {
    console.warn('[WS] Unexpected message type:', typeof event.data);
    return;
  }
  handleServer(buf);
});

const canvas = document.getElementById('game');
canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

const ctx = canvas.getContext('2d');
ctx.font = '24px sans-serif';
ctx.fillStyle = 'white';
ctx.textBaseline = 'top';

// --- Client state ---
const state = {
    phase: 'lobby',        // 'lobby', 'countdown', 'race', 'finished'
    players: [],           // array of  name 
    countdown: 0,          // seconds left
    text: '',              // full race text
    charStates: [],        // status per char: 'pending' | 'correct' | 'wrong'
    position: 0,           // player progress
    otherProgress: {},     // map name -> position
    results: []            // array of { name, timeMs }
};

const playerColors = {};
const colorPalette = ['blue', 'orange', 'magenta', 'cyan', 'lime', 'pink', 'gold'];

function getPlayerColor(name) {
    if (!playerColors[name]) {
        playerColors[name] = colorPalette[Object.keys(playerColors).length % colorPalette.length];
    }
    return playerColors[name];
}

// --- WebSocket setup ---
let playerName = null;
let roomId = null;
// socket.addEventListener('message', onMessage);

// function promptAndJoin(isRoom = false) {
//     if (!roomId || !isRoom) {
//         roomId = prompt('Enter your room:');
//     }
//     if (!roomId) return promptAndJoin();
//     playerName = prompt('Enter your name:');
//     if (!playerName) return promptAndJoin();
//     msg = { type: 'join', payload: { name: playerName , room: roomId} }
//     socket.send(JSON.stringify(msg));
//     console.log(msg)
// }

// Sending Join:
function sendJoin(room, name, reconnect) {
  const type = 0;
  const roomBuf = encodeString(room);
  const nameBuf = encodeString(name);
  const buf = new Uint8Array(1 + roomBuf.length + nameBuf.length + 1);
  let off = 0;
  buf[off++] = type;
  buf.set(roomBuf, off); off += roomBuf.length;
  buf.set(nameBuf, off); off += nameBuf.length;
  buf[off] = reconnect ? 1 : 0;
  socket.send(buf);
}

function promptAndJoin(isReconnection = false) {
  // try stored values first
  if (!isReconnection && localStorage.roomId && localStorage.playerName) {
    roomId   = localStorage.roomId;
    playerName = localStorage.playerName;
  } else {
    roomId = prompt('Enter your room:');
    if (!roomId) return promptAndJoin();
    playerName = prompt('Enter your name:');
    if (!playerName) return promptAndJoin();
    // persist them
    localStorage.roomId = roomId;
    localStorage.playerName = playerName;
  }

  sendJoin(roomId, playerName, isReconnection)
}

// Handling incoming server messages:
function handleServer(buf) {
  let off = 0;
  const type = buf[off++];
  switch (type) {
    case 2: { // LobbyUpdate
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const count = dv.getUint16(0, false);
      off += 2;
      const players = [];
      for (let i = 0; i < count; i++) {
        const [name, len] = decodeString(buf, off);
        off += len;
        players.push(name);
      }
      state.phase = 'lobby';
      state.players = players;
      render();
      break;
    }
    case 3: { // NameConflict
      alert('Name already taken, please choose another.');
      promptAndJoin();
      break;
    }
    case 4: { // Countdown
      const seconds = buf[off++];
      state.phase = 'countdown';
      state.countdown = seconds;
      render();
      break;
    }
    case 5: { // StartRace
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const len = dv.getUint16(0, false);
      off += 2;
      const textBytes = new Uint8Array(buf.buffer, buf.byteOffset + off, len);
      state.phase = 'race';
      state.text = new TextDecoder().decode(textBytes);
      state.charStates = Array.from(state.text, () => 'pending');
      state.position = 0;
      state.otherProgress = {};
      render();
      break;
    }
    case 6: { // Feedback
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const pos = dv.getUint16(0, false);
      off += 2;
      const correct = buf[off++] !== 0;
      const [ch, len] = decodeString(buf, off);
      off += len;
      state.charStates[pos] = correct ? 'correct' : 'wrong';
      if (correct) state.position = pos + 1;
      render();
      break;
    }
    case 7: { // ProgressUpdate
      const [name, nameLen] = decodeString(buf, off);
      off += nameLen;
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const pos = dv.getUint16(0, false);
      state.otherProgress[name] = pos;
      render();
      break;
    }
    case 8: { // Finish
      const [name, nameLen2] = decodeString(buf, off);
      off += nameLen2;
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const timeMs = dv.getBigUint64(0, false);
      // Optionally store individual finishes
      render();
      break;
    }
    case 9: { // RaceResult
      const dv = new DataView(buf.buffer, buf.byteOffset + off);
      const countR = dv.getUint16(0, false);
      off += 2;
      const results = [];
      for (let i = 0; i < countR; i++) {
        const [nm, l] = decodeString(buf, off);
        off += l;
        const dv2 = new DataView(buf.buffer, buf.byteOffset + off);
        const t = dv2.getBigUint64(0, false);
        off += 8;
        results.push([nm, Number(t)]);
      }
      state.phase = 'finished';
      state.results = results;
      render();
      break;
    }
    default:
      console.warn('Unknown msg type:', type);
  }
}

// --- Handle keyboard ---
// Sending Keystroke:
function sendKeystroke(char) {
  const type = 1;
  const charUtf8 = new TextEncoder().encode(char);
  const buf = new Uint8Array(1 + 2 + charUtf8.length);
  buf[0] = type;
  const dv = new DataView(buf.buffer);
  dv.setUint16(1, charUtf8.length, false);
  buf.set(charUtf8, 3);
  socket.send(buf);
}

window.addEventListener('keydown', e => {
    // TODO: check if posision = len(text) then dont send
    if (state.phase !== 'race') return;
    let char = e.key;
    if (char === 'Backspace') char = '\b';
    if (char.length > 1 && char !== '\b' && char !== 'Enter') return;
    sendKeystroke(char)
    console.log(char)
});

// --- Rendering ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    switch (state.phase) {
        case 'lobby':
            drawLobby();
            break;
        case 'countdown':
            drawCountdown();
            break;
        case 'race':
            drawRace();
            break;
        case 'finished':
            drawResults();
            break;
    }
}

function drawLobby() {
    ctx.fillStyle = '#fff';
    ctx.fillText('Waiting for players...', 20, 20);
    state.players.forEach((p, i) => {
        // ctx.fillText(`• ${p.name}`, 20, 60 + i * 30);
        ctx.fillText(`• ${p}`, 20, 60 + i * 30);
    });
}

function drawCountdown() {
    ctx.fillStyle = '#333';
    ctx.font = 'bold 60px sans-serif';
    ctx.fillText(state.countdown, canvas.width/2 - 15, canvas.height/2 - 40);
    ctx.font = '20px sans-serif';
}

function drawResults() {
    ctx.fillStyle = '#fff';
    ctx.fillText('Results:', 20, 20);
    state.results.forEach((r, i) => {
        const [name, timeMs] = r;  // destructure the tuple
        ctx.fillText(
            `${i + 1}. ${name} - ${(timeMs / 1000).toFixed(2)}s`,
            20,
            60 + i * 30
        );
    });
}

function drawRace() {
    const y0 = 20, lineHeight = 30;
    let line = '';
    let lines = [];

    for (let ch of state.text) {
        const testLine = line + ch;
        const width = ctx.measureText(testLine).width;
        if (ch === '\n' || width > canvas.width - 40) {
            lines.push(line);
            line = ch === '\n' ? '' : ch;
        } else {
            line = testLine;
        }
    }
    if (line) lines.push(line);

    const totalHeight = lines.length * lineHeight;
    let y = (canvas.height - totalHeight) / 2;

    let charIndex = 0;
    for (let l = 0; l < lines.length; l++) {
        const lineText = lines[l];
        const lineWidth = ctx.measureText(lineText).width;
        let x = (canvas.width - lineWidth) / 2;

        for (let i = 0; i < lineText.length; i++) {
            const ch = lineText[i];
            const status = state.charStates[charIndex];
            // if (status === 'correct') ctx.fillStyle = 'green';
            //
            // console.log('status:', status, 'i:', i, 'position:', state.position);
            if (status === 'correct' || i < state.position) ctx.fillStyle = 'green';
            else if (status === 'wrong') ctx.fillStyle = 'red';
            else ctx.fillStyle = '#555';
            ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width;
            charIndex++;
        }
        y += lineHeight;
    }

    // draw other players' cursors as dots
    for (const [id, pos] of Object.entries(state.otherProgress)) {
        const coords = getCharCoords(pos);
        ctx.fillStyle = getPlayerColor(id);
        ctx.fillRect(coords.x, coords.y + 22, 6, 6);
    }
}

// Helper: compute on-canvas coords for char index
function getCharCoords(index) {
    const lineHeight = 30;
    const padding = 20;

    let lines = [];
    let line = '';
    let charCount = 0;

    for (let ch of state.text) {
        const testLine = line + ch;
        const width = ctx.measureText(testLine).width;
        if (ch === '\n' || width > canvas.width - 40) {
            lines.push(line);
            line = ch === '\n' ? '' : ch;
        } else {
            line = testLine;
        }
    }
    if (line) lines.push(line);

    const totalHeight = lines.length * lineHeight;
    const yStart = (canvas.height - totalHeight) / 2;

    let count = 0;
    for (let l = 0; l < lines.length; l++) {
        const lineText = lines[l];
        const lineWidth = ctx.measureText(lineText).width;
        let x = (canvas.width - lineWidth) / 2;
        let y = yStart + l * lineHeight;

        for (let i = 0; i < lineText.length; i++) {
            if (count === index) {
                return { x, y };
            }
            x += ctx.measureText(lineText[i]).width;
            count++;
        }
    }

    return { x: canvas.width - padding, y: yStart + lines.length * lineHeight };
}
// Initial draw
render();

