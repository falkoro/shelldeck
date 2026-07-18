function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function drawSafeShot(): HTMLCanvasElement {
  const shells = latestShells.length ? latestShells : sessions().map((session) => ({
    name: session.name,
    label: session.label,
    running: session.running,
    cwd: '',
    command: '',
    output: '',
  }));
  const modelSessions = sessions();
  const width = Math.min(2200, Math.max(1600, Math.round(window.innerWidth || 1600)));
  const pad = 40;
  const gap = 18;
  const topH = 98;
  const tickerH = 54;
  const contentTop = pad + topH + tickerH + gap * 2;
  const sidebarW = width >= 1900 ? 370 : 330;
  const mainX = pad + sidebarW + gap;
  const mainW = width - mainX - pad;
  const tabCols = Math.max(2, Math.min(width >= 1900 ? 4 : 3, Math.floor(mainW / 330)));
  const tabRows = Math.max(1, Math.ceil(Math.max(1, modelSessions.length) / tabCols));
  const tabW = Math.floor((mainW - 28 - (tabCols - 1) * 10) / tabCols);
  const cardCols = mainW >= 1080 ? 2 : 1;
  const cardW = Math.floor((mainW - 28 - (cardCols - 1) * 14) / cardCols);
  const cardH = 206;
  const cardRows = Math.max(1, Math.ceil(shells.length / cardCols));
  const shellPanelH = 72 + tabRows * 44 + 56 + cardRows * (cardH + 14) + 28;
  const sidebarH = 860;
  const height = Math.max(980, contentTop + Math.max(shellPanelH, sidebarH) + pad);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create safe screenshot');
  const text = (value: string, x: number, y: number, maxWidth?: number): void => {
    ctx.fillText(value, x, y, maxWidth);
  };
  const panel = (x: number, y: number, w: number, h: number, title: string, subtitle = ''): void => {
    ctx.fillStyle = '#0b121a';
    roundedRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '700 18px Segoe UI, sans-serif';
    text(title, x + 16, y + 28, w - 32);
    if (subtitle) {
      ctx.fillStyle = '#91a7b7';
      ctx.font = '13px Segoe UI, sans-serif';
      text(subtitle, x + 16, y + 48, w - 32);
    }
  };
  const pill = (x: number, y: number, label: string, color = '#cfeaff', w = 118): void => {
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x, y, w, 32, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.25)';
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 13px Segoe UI, sans-serif';
    text(label, x + 14, y + 21, w - 24);
  };
  const line = (x: number, y: number, w: number, color = 'rgba(145,167,183,.24)'): void => {
    ctx.fillStyle = color;
    roundedRect(ctx, x, y, w, 7, 4);
    ctx.fill();
  };
  const button = (x: number, y: number, label: string, w = 92): void => {
    ctx.fillStyle = '#0c1720';
    roundedRect(ctx, x, y, w, 30, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.25)';
    ctx.stroke();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '700 12px Segoe UI, sans-serif';
    text(label, x + 12, y + 20, w - 18);
  };
  ctx.fillStyle = '#070b10';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0b121a';
  roundedRect(ctx, pad, pad, width - pad * 2, topH, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  ctx.fillStyle = '#8bf6ff';
  roundedRect(ctx, pad + 22, pad + 22, 54, 54, 10);
  ctx.fill();
  ctx.fillStyle = '#061014';
  ctx.font = '900 17px Segoe UI, sans-serif';
  text('SD', pad + 38, pad + 57);
  ctx.fillStyle = '#edf7ff';
  ctx.font = '800 28px Segoe UI, sans-serif';
  text('ShellDeck', pad + 92, pad + 42);
  ctx.fillStyle = '#91a7b7';
  ctx.font = '14px Segoe UI, sans-serif';
  text('Safe dashboard snapshot. Hostnames, paths, commands, shell names, and output are hidden.', pad + 92, pad + 66, 760);
  const running = shells.filter((shell) => shell.running).length;
  const waiting = shells.filter((shell) => shell.running && !shellWorking(shell.name)).length;
  const active = shells.filter((shell) => shell.running && shellWorking(shell.name)).length;
  const stats = [`${shells.length} shells`, `${active} active`, `${waiting} waiting`, `${Math.max(0, shells.length - running)} offline`];
  stats.forEach((value, idx) => {
    pill(width - pad - 520 + idx * 128, pad + 33, value, idx === 1 ? '#72f7c8' : idx === 2 ? '#ffc857' : '#cfeaff', 116);
  });
  ctx.fillStyle = '#0b121a';
  roundedRect(ctx, pad, pad + topH + gap, width - pad * 2, tickerH, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  ctx.fillStyle = '#91a7b7';
  ctx.font = '700 13px Segoe UI, sans-serif';
  text(dashboardSettings.tickers.length ? `${dashboardSettings.tickers.length} tickers configured` : 'Ticker bar empty', pad + 16, pad + topH + gap + 32, 260);
  for (let i = 0; i < Math.min(6, Math.max(3, dashboardSettings.tickers.length || 3)); i += 1) {
    const x = pad + 250 + i * 112;
    pill(x, pad + topH + gap + 11, `TICK ${i + 1}`, i % 2 ? '#ff9fb4' : '#72f7c8', 92);
  }
  button(width - pad - 130, pad + topH + gap + 12, 'Configure', 112);
  // side panels redacted as blocks
  panel(pad, contentTop, sidebarW, 600, "Panels", "Redacted");
  panel(mainX, contentTop, mainW, shellPanelH, 'Shells', 'All panes side-by-side. Text and output redacted.');
  const toolsX = mainX + mainW - 514;
  ['Grid', '80', 'Follow', 'Compact', 'Refresh'].forEach((label, idx) => button(toolsX + idx * 100, contentTop + 18, label, 88));
  modelSessions.forEach((session, idx) => {
    const state = sessionRuntime(session);
    const col = idx % tabCols;
    const row = Math.floor(idx / tabCols);
    const x = mainX + 14 + col * (tabW + 10);
    const y = contentTop + 76 + row * 44;
    ctx.fillStyle = session.name === selectedSession ? '#10202b' : '#0d151f';
    roundedRect(ctx, x, y, tabW, 34, 7);
    ctx.fill();
    ctx.strokeStyle = session.name === selectedSession ? 'rgba(139,246,255,.7)' : 'rgba(255,255,255,.09)';
    ctx.stroke();
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x + 10, y + 6, 34, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '900 12px Cascadia Mono, monospace';
    text(String(session.badge || idx + 1).slice(0, 2).toUpperCase(), x + 20, y + 21, 22);
    ctx.fillStyle = state.dotClass === 'on' ? '#72f7c8' : state.dotClass === 'wait' ? '#ffc857' : '#ff6a7a';
    ctx.beginPath();
    ctx.arc(x + 58, y + 17, 4, 0, Math.PI * 2);
    ctx.fill();
    line(x + 70, y + 13, tabW - 96, 'rgba(207,234,255,.28)');
  });
  const actionY = contentTop + 86 + tabRows * 44;
  ctx.fillStyle = '#071017';
  roundedRect(ctx, mainX + 14, actionY, mainW - 28, 42, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  line(mainX + 30, actionY + 17, 230, 'rgba(207,234,255,.24)');
  button(mainX + mainW - 274, actionY + 6, 'Create', 78);
  button(mainX + mainW - 188, actionY + 6, 'Restart', 86);
  button(mainX + mainW - 94, actionY + 6, 'Attach', 76);
  const cardsTop = actionY + 56;
  shells.forEach((shell, idx) => {
    const col = idx % cardCols;
    const row = Math.floor(idx / cardCols);
    const x = mainX + 14 + col * (cardW + 14);
    const y = cardsTop + row * (cardH + 14);
    const activeShell = shell.running && shellWorking(shell.name);
    const waitingShell = shell.running && !activeShell;
    ctx.fillStyle = '#050a0f';
    roundedRect(ctx, x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.strokeStyle = activeShell ? 'rgba(114,247,200,.5)' : waitingShell ? 'rgba(255,200,87,.45)' : 'rgba(139,246,255,.22)';
    ctx.stroke();
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x + 1, y + 1, cardW - 2, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '800 17px Segoe UI, sans-serif';
    text(`Shell ${idx + 1}`, x + 18, y + 28);
    ctx.fillStyle = activeShell ? '#72f7c8' : waitingShell ? '#ffc857' : '#ff6a7a';
    ctx.beginPath();
    ctx.arc(x + cardW - 28, y + 23, 6, 0, Math.PI * 2);
    ctx.fill();
    line(x + 18, y + 62, cardW - 60, 'rgba(139,246,255,.2)');
    ctx.fillStyle = '#03070b';
    roundedRect(ctx, x + 18, y + 78, cardW - 36, 42, 7);
    ctx.fill();
    line(x + 32, y + 96, cardW - 92, 'rgba(145,167,183,.22)');
    for (let i = 0; i < 5; i += 1) {
      button(x + 18 + i * 76, y + 130, ['Send', 'Paste', 'Image', 'Mic', 'Enter'][i], 68);
    }
    ctx.fillStyle = '#03070b';
    roundedRect(ctx, x + 18, y + 166, cardW - 36, 24, 7);
    ctx.fill();
    for (let i = 0; i < 3; i += 1) {
      line(x + 32 + i * 118, y + 175, Math.min(88, cardW - 72 - i * 118), 'rgba(145,167,183,.18)');
    }
  });
  ctx.fillStyle = '#91a7b7';
  ctx.font = '13px Segoe UI, sans-serif';
  text(`Generated ${new Date().toLocaleString()} by ShellDeck safe shot`, pad, height - 24, width - pad * 2);
  return canvas;
}
