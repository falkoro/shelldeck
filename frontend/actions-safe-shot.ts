function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export safe screenshot'));
    }, 'image/png');
  });
}

async function writeImageToClipboard(blob: Blob): Promise<boolean> {
  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (!navigator.clipboard || !ClipboardItemCtor) return false;
  await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
  return true;
}

async function createSafeShot(): Promise<void> {
  const button = document.getElementById('safeShotBtn') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    const canvas = drawSafeShot();
    const blob = await canvasToPngBlob(canvas);
    const copied = await writeImageToClipboard(blob).catch(() => false);
    await postJson('/api/share-shot', { dataUrl: canvas.toDataURL('image/png') });
    toast(copied ? 'Safe shot copied and saved in share/' : 'Safe shot saved in share/');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadTickers(): Promise<void> {
  if (!document.getElementById('tickerBar') || !dashboardSettings.panels.tickers) return;
  const response = await fetch('/api/tickers', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { tickers?: Ticker[]; unconfigured?: boolean };
  renderTickers(payload.tickers || [], payload.unconfigured ?? false);
}

