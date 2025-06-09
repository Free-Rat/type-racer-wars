// render.js

// you’ll need access to the same canvas/context, so:
// either pass `ctx`, `canvas`, and `state` in to each function,
// or export a factory that binds them once.

export function drawLobby(ctx, state) {
  ctx.fillStyle = '#fff';
  ctx.fillText('Waiting for players...', 20, 20);
  state.players.forEach((p, i) => {
    ctx.fillText(`• ${p}`, 20, 60 + i * 30);
  });
}

export function drawCountdown(ctx, canvas, state) {
  ctx.fillStyle = '#333';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText(state.countdown, canvas.width/2 - 15, canvas.height/2 - 40);
  // remember to reset font if you change it
  ctx.font = '24px sans-serif';
}

export function getCharCoords(ctx, canvas, state, index) {
  const lineHeight = 30;
  const padding = 20;
  const lines = [];
  let line = '';
  for (let ch of state.text) {
    const testLine = line + ch;
    if (ch === '\n' || ctx.measureText(testLine).width > canvas.width - 40) {
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
    const text = lines[l];
    let x = (canvas.width - ctx.measureText(text).width) / 2;
    let y = yStart + l * lineHeight;
    for (let i = 0; i < text.length; i++) {
      if (count === index) return { x, y };
      x += ctx.measureText(text[i]).width;
      count++;
    }
  }
  return { x: canvas.width - padding, y: yStart + lines.length * lineHeight };
}

export function drawRace(ctx, canvas, state) {
  const y0 = 20, lineHeight = 30;
  const lines = [];
  let line = '';
  for (let ch of state.text) {
    const test = line + ch;
    if (ch === '\n' || ctx.measureText(test).width > canvas.width - 40) {
      lines.push(line);
      line = ch === '\n' ? '' : ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  // center vertically
  let y = (canvas.height - lines.length * lineHeight) / 2;
  let charIndex = 0;

  for (const textLine of lines) {
    let x = (canvas.width - ctx.measureText(textLine).width) / 2;
    for (let i = 0; i < textLine.length; i++) {
      const status = state.charStates[charIndex];
      if (status === 'correct') ctx.fillStyle = 'green';
      else if (status === 'wrong') ctx.fillStyle = 'red';
      else ctx.fillStyle = '#555';
      ctx.fillText(textLine[i], x, y);
      x += ctx.measureText(textLine[i]).width;
      charIndex++;
    }
    y += lineHeight;
  }

  // draw other players
  for (const [name, pos] of Object.entries(state.otherProgress)) {
    const { x, y } = getCharCoords(ctx, canvas, state, pos);
    ctx.fillStyle = getPlayerColor(name);
    ctx.fillRect(x, y + 22, 6, 6);
  }
}

export function drawResults(ctx, state) {
  ctx.fillStyle = '#fff';
  ctx.fillText('Results:', 20, 20);
  state.results.forEach(({ name, timeMs }, i) => {
    ctx.fillText(
      `${i + 1}. ${name} - ${(timeMs / 1000).toFixed(2)}s`,
      20,
      60 + i * 30
    );
  });
}
