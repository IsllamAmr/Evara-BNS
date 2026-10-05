import { getAppConfig } from './supabaseClient.js';
import { t } from './i18n.js';
import { escapeHtml } from './shared.js';

let activeScanner = null;
let decoderPromise = null;

function loadDecoder() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!decoderPromise) {
    decoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/jsQR.js', import.meta.url).href;
      script.async = true;
      script.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error('QR decoder unavailable'));
      script.onerror = () => { script.remove(); reject(new Error('QR decoder unavailable')); };
      document.head.append(script);
    }).catch((error) => { decoderPromise = null; throw error; });
  }
  return decoderPromise;
}

// Only extract the attendance token from a QR belonging to this application.
// Navigation remains local; the attendance API still validates the token and network.
export function officeQrDestination(value) {
  try {
    const url = new URL(value);
    const origins = new Set([window.location.origin, new URL(getAppConfig().appUrl).origin]);
    if (!origins.has(url.origin) || url.username || url.password) return null;
    if (!['/checkin', '/checkin.html'].includes(url.pathname)) return null;
    const token = url.searchParams.get('k') || '';
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null;
    return `/checkin?k=${encodeURIComponent(token)}`;
  } catch { return null; }
}

export function scanOfficeQr() {
  if (activeScanner) return Promise.resolve(null);
  const dialog = document.createElement('dialog');
  dialog.className = 'qr-camera-dialog';
  dialog.setAttribute('aria-labelledby', 'qr-camera-title');
  dialog.innerHTML = `
    <header class="qr-camera-header">
      <div><h2 id="qr-camera-title">${escapeHtml(t('qrScanner.title'))}</h2><p>${escapeHtml(t('qrScanner.hint'))}</p></div>
      <button type="button" class="qr-camera-close" aria-label="${escapeHtml(t('qrScanner.close'))}">×</button>
    </header>
    <div class="qr-camera-preview">
      <video muted playsinline aria-label="${escapeHtml(t('qrScanner.preview'))}"></video>
      <div class="qr-camera-guide" aria-hidden="true"></div>
    </div>
    <p class="qr-camera-status" role="status" aria-live="polite"></p>
    <div class="qr-camera-actions">
      <button type="button" class="btn btn-primary qr-camera-retry hidden">${escapeHtml(t('qrScanner.retry'))}</button>
      <button type="button" class="btn btn-secondary qr-camera-cancel">${escapeHtml(t('common.cancel'))}</button>
    </div>`;
  const video = dialog.querySelector('video');
  const status = dialog.querySelector('.qr-camera-status');
  const retry = dialog.querySelector('.qr-camera-retry');
  const previousFocus = document.activeElement;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let closed = false;
  let stream = null;
  let timer;
  let generation = 0;
  document.body.append(dialog);
  activeScanner = dialog;

  return new Promise((resolve) => {
    function stopCamera() {
      generation++;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    }

    function finish(destination = null) {
      if (closed) return;
      closed = true;
      stopCamera();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      dialog.close();
      dialog.remove();
      activeScanner = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(destination);
    }

    function setStatus(key, error = false) {
      const message = t(key);
      if (status.textContent !== message) status.textContent = message;
      status.classList.toggle('error', error);
    }

    function showError(key) {
      stopCamera();
      setStatus(key, true);
      retry.classList.remove('hidden');
    }

    function onVisibilityChange() {
      if (document.hidden) finish();
    }

    function onPageHide() { finish(); }

    async function startCamera() {
      stopCamera();
      const attempt = generation;
      retry.classList.add('hidden');
      setStatus('qrScanner.opening');
      if (!window.isSecureContext) { showError('qrScanner.secureRequired'); return; }
      if (!navigator.mediaDevices?.getUserMedia || !context) { showError('qrScanner.unsupported'); return; }
      try {
        const decode = await loadDecoder();
        if (closed || attempt !== generation) return;
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        // Permission can finish after the user closes the dialog or leaves the page.
        if (closed || attempt !== generation) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
          if (!closed && attempt === generation) showError('qrScanner.interrupted');
        }));
        video.srcObject = stream;
        await video.play();
        if (closed || attempt !== generation) return;
        setStatus('qrScanner.scanning');

        function scanFrame() {
          if (closed || attempt !== generation) return;
          try {
            if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
              const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
              const width = Math.max(1, Math.round(video.videoWidth * scale));
              const height = Math.max(1, Math.round(video.videoHeight * scale));
              if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
              context.drawImage(video, 0, 0, width, height);
              const pixels = context.getImageData(0, 0, width, height);
              const code = decode(pixels.data, width, height, { inversionAttempts: 'dontInvert' });
              if (code?.data) {
                const destination = officeQrDestination(code.data);
                if (destination) { finish(destination); return; }
                setStatus('qrScanner.wrongCode', true);
              }
            }
            // Limit image processing to five frames per second on phones.
            timer = window.setTimeout(scanFrame, 200);
          } catch { showError('qrScanner.readFailed'); }
        }
        scanFrame();
      } catch (error) {
        if (closed || attempt !== generation) return;
        const key = {
          NotAllowedError: 'qrScanner.permissionDenied',
          SecurityError: 'qrScanner.permissionDenied',
          NotFoundError: 'qrScanner.noCamera',
          NotReadableError: 'qrScanner.cameraBusy',
          AbortError: 'qrScanner.interrupted',
        }[error.name] || 'qrScanner.readFailed';
        showError(key);
      }
    }

    dialog.querySelector('.qr-camera-close').addEventListener('click', () => finish());
    dialog.querySelector('.qr-camera-cancel').addEventListener('click', () => finish());
    retry.addEventListener('click', startCamera);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(); });
    dialog.addEventListener('close', () => finish());
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish();
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    dialog.showModal();
    startCamera();
  });
}
