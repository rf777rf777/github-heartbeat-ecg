let lastActive = null;
let resolver = null;

const $ = (id) => document.getElementById(id);
const overlay = $('msgOverlay');
const btnOk   = $('msgOkBtn');
const btnX    = $('msgCloseBtn');
const txt     = $('msgText');
const titleEl = $('msgTitle');

function lockScroll(lock) {
  document.body.style.overflow = lock ? 'hidden' : '';
}

function close(ret='ok') {
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  lockScroll(false);
  if (lastActive && typeof lastActive.focus === 'function') {
    lastActive.focus();
  }
  if (resolver) { resolver(ret); resolver = null; }
  window.removeEventListener('keydown', onKey);
  overlay.removeEventListener('click', onOverlayClick);
}

function onKey(e){
  if (e.key === 'Escape') { e.preventDefault(); close('esc'); }
  if (e.key === 'Enter')  { e.preventDefault(); close('ok'); }
}

function onOverlayClick(e){
  if (e.target === overlay) close('overlay');
}

// ✅ 對外 export
export function showMessage(message, options = {}) {
  const { title = 'Message', okText = 'OK' } = options;

  lastActive = document.activeElement;
  txt.textContent = message;
  titleEl.textContent = title;
  btnOk.textContent = okText;

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  lockScroll(true);

  window.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onOverlayClick);
  btnOk.onclick = () => close('ok');
  btnX.onclick  = () => close('x');

  setTimeout(() => btnOk.focus(), 0);

  return new Promise(res => { resolver = res; });
}
