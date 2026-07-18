// frontend/actions-images.ts
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function imageNameWithExtension(name: string, extension: string): string {
  const raw = name || 'pasted-image';
  const base = raw.replace(/\.[a-z0-9]+$/i, '') || 'pasted-image';
  return `${base}.${extension}`;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not optimize image'));
    }, type, quality);
  });
}

function renderImageCanvas(image: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not optimize image');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function optimizeImageForAgents(file: File): Promise<File> {
  if (file.size <= AGENT_IMAGE_TARGET_BYTES) return file;
  const image = await loadImageElement(file);
  let best: Blob | null = null;
  for (const maxEdge of AGENT_IMAGE_MAX_EDGES) {
    const canvas = renderImageCanvas(image, maxEdge);
    for (const quality of AGENT_IMAGE_QUALITIES) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= AGENT_IMAGE_TARGET_BYTES) {
        return new File([blob], imageNameWithExtension(file.name, 'jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }
  }
  if (best && best.size < file.size) {
    return new File([best], imageNameWithExtension(file.name, 'jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  }
  return file;
}

async function uploadImageForShell(
  file: File,
  name: string,
  setStatus: (text: string) => void = (text) => setShellStatus(name, text),
): Promise<ImageUploadResult> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  if (!name) throw new Error('Choose a shell first');
  if (!String(file.type || '').startsWith('image/')) throw new Error('That file is not an image');
  if (!SUPPORTED_UPLOAD_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
    throw new Error('Supported image types are PNG, JPEG, WebP, and GIF');
  }
  setStatus(file.size > AGENT_IMAGE_TARGET_BYTES ? 'Optimizing image...' : 'Saving image...');
  const uploadFile = await optimizeImageForAgents(file);
  const optimized = uploadFile !== file;
  setStatus(`Saving image (${formatBytes(uploadFile.size)})...`);
  const payload = await postJson('/api/upload-image', {
    name: uploadFile.name || 'pasted-image',
    type: uploadFile.type,
    dataUrl: await fileToDataUrl(uploadFile),
  });
  if (!payload.image) throw new Error('Image upload did not return an image');
  addShellImage(name, payload.image);
  renderShellImages(name);
  return { image: payload.image, optimized, originalBytes: file.size };
}

async function uploadImageFile(file: File, name: string): Promise<void> {
  const result = await uploadImageForShell(file, name);
  const { image, optimized, originalBytes } = result;
  appendInput(image.path, name);
  const sizeNote = optimized ? `optimized ${formatBytes(originalBytes)} -> ${formatBytes(image.bytes)}` : formatBytes(image.bytes);
  setShellStatus(name, `Inserted ${image.path} (${sizeNote})`);
  toast(optimized ? 'Optimized image path inserted' : 'Image path inserted');
}

async function handleImageFiles(files: FileList | File[] | undefined, name: string): Promise<void> {
  const images = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/'));
  for (const image of images) await uploadImageFile(image, name);
}

function pasteImageFiles(event: ClipboardEvent, name?: string): void {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  handleImageFiles(files, name || shellNameFromElement(event.target instanceof Element ? event.target : null)).catch((error: Error) => {
    toast(error.message);
  });
}

