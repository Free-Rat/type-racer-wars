const socket = new WebSocket("ws://localhost:3000/ws");

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

// --- WebSocket setup ---
let playerName = null;
socket.addEventListener('open', promptAndJoin);
socket.addEventListener('message', onMessage);

function promptAndJoin() {
    roomId = prompt('Enter your room:');
    if (!roomId) return promptAndJoin();
    playerName = prompt('Enter your name:');
    if (!playerName) return promptAndJoin();
    socket.send(JSON.stringify({ type: 'join', payload: { name: playerName , room: roomId} }));
}

function onMessage(event) {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case 'lobbyUpdate':
            state.phase = 'lobby';
            state.players = msg.payload.players; // array of names
            break;
        case 'nameConflict':
            alert('Name already taken, please choose another.');
            promptAndJoin();
            return;
        case 'countdown':
            state.phase = 'countdown';
            state.countdown = msg.payload.secondsLeft;
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
    socket.send(JSON.stringify({
        type: 'keystroke',
        payload: { char }
    }));
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
        ctx.fillText(`• ${p.name}`, 20, 60 + i * 30);
    });
}

function drawCountdown() {
    ctx.fillStyle = '#333';
    ctx.font = 'bold 60px sans-serif';
    ctx.fillText(state.countdown, canvas.width/2 - 15, canvas.height/2 - 40);
    ctx.font = '20px sans-serif';
}

function drawRace() {
    const x0 = 20, y0 = 20, lineHeight = 30;
    let x = x0, y = y0;
    for (let i = 0; i < state.text.length; i++) {
        const ch = state.text[i];
        const status = state.charStates[i];
        if (status === 'correct') ctx.fillStyle = 'green';
        else if (status === 'wrong') ctx.fillStyle = 'red';
        else ctx.fillStyle = '#555';
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width;
        if (ch === '\n' || x > canvas.width - 20) {
            x = x0;
            y += lineHeight;
        }
    }
    // draw other players' cursors as dots
    for (const [id, pos] of Object.entries(state.otherProgress)) {
        const coords = getCharCoords(pos);
        ctx.fillStyle = 'blue';
        ctx.fillRect(coords.x, coords.y + 22, 4, 4);
    }
}

function drawResults() {
    ctx.fillStyle = '#000';
    ctx.fillText('Results:', 20, 20);
    state.results.forEach((r, i) => {
        ctx.fillText(
            `${i+1}. ${r.name} - ${(r.timeMs/1000).toFixed(2)}s`, 
            20, 
            60 + i * 30
        );
    });
}

// Helper: compute on-canvas coords for char index
function getCharCoords(index) {
    const x0 = 20, y0 = 20, lineHeight = 30;
    let x = x0, y = y0;
    for (let i = 0; i < index && i < state.text.length; i++) {
        const ch = state.text[i];
        x += ctx.measureText(ch).width;
        if (ch === '\n' || x > canvas.width - 20) {
            x = x0;
            y += lineHeight;
        }
    }
    return { x, y };
}

// Initial draw
render();
