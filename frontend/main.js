const socket = new WebSocket("ws://localhost:3000/ws");

socket.addEventListener('open', () => console.log('[WS] open'));
socket.addEventListener('error', err => console.error('[WS] error', err));
socket.addEventListener('close', () => console.log('[WS] closed'));
socket.addEventListener('message', event => {
  console.log('[WS] raw message:', event.data);
  // onMessage(event);
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
socket.addEventListener('open', () => {
  // isReconnection = true to tell the server "Hey, I was already here"
  promptAndJoin(/* isReconnection = */ true);
});
socket.addEventListener('message', onMessage);

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

  socket.send(JSON.stringify({
    type: 'join',
    payload: { room: roomId, name: playerName, reconnect: isReconnection }
  }));
}

function onMessage(event) {
    const msg = JSON.parse(event.data);
    console.log(msg)
    switch (msg.type) {
        case 'lobbyUpdate':
            state.phase = 'lobby';
            state.players = msg.payload.players; // array of names
            break;
        case 'nameConflict':
            // Fix: delay prompt so user input doesn't race message flow
            // const currentPlayers = state.players || [];
            // if (!currentPlayers.includes(playerName)) {
            //     setTimeout(() => {
            //         alert('Name already taken, please choose another.');
            //         promptAndJoin(true);
            //     }, 100);  // slight delay to prevent overlap
            // };
            alert('Name already taken, please choose another.');
            promptAndJoin();
            return;
        case 'countdown':
            state.phase = 'countdown';
            state.countdown = msg.payload.seconds_left;
            break;
        case 'startRace':
            state.phase = 'race';
            state.text = msg.payload.text;
            state.charStates = Array.from(state.text, () => 'pending');
            state.position = 0;
            state.otherProgress = {};
            break;
        case 'feedback':
            const { correct, position } = msg.payload;
            state.charStates[position] = correct ? 'correct' : 'wrong';
            if (correct) state.position = position + 1;
            break;
        case 'progressUpdate':
            state.otherProgress[msg.payload.name] = msg.payload.position;
            break;
        case 'raceResult':
            state.phase = 'finished';
            state.results = msg.payload.results; // array of { name, timeMs }
            break;
        case 'error':
            alert('Error: ' + msg.payload.message);
            return;
    }
    render();
}

// --- Handle keyboard ---
window.addEventListener('keydown', e => {
    // TODO: check if posision = len(text) then dont send
    if (state.phase !== 'race') return;
    let char = e.key;
    if (char === 'Backspace') char = '\b';
    if (char.length > 1 && char !== '\b' && char !== 'Enter') return;
    msg = {
        type: 'keystroke',
        payload: { char }
    }
    socket.send(JSON.stringify(msg));
    console.log(msg)
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
