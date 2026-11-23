// The original files and thumbnails stay in a private bucket; signed URLs expire.
const ALBUM_BUCKET = 'private-memories';
const ALBUM_LIMIT = 50 * 1024 * 1024;
let albumBusy = false;
let albumLoadVersion = 0;
let albumObserver = null;
let albumDialog = null;
let albumReturnFocus = null;

function albumThumbnailPath(path) {
  const slash = path.indexOf('/');
  return `${path.slice(0, slash)}/.thumbs/${path.slice(slash + 1)}.jpg`;
}
async function albumSignedUrl(path) {
  const {data, error} = await sb.storage.from(ALBUM_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw error || new Error('无法获取文件');
  return data.signedUrl;
}
function albumIsVideo(name) { return /\.(mp4|webm|mov)$/i.test(name); }
function closeAlbumViewer() {
  if (!albumDialog) return;
  const media = albumDialog.querySelector('video');
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  albumDialog.remove(); albumDialog = null;
  document.body.classList.remove('album-viewer-open');
  albumReturnFocus?.focus(); albumReturnFocus = null;
}
async function openAlbumViewer(file, trigger) {
  closeAlbumViewer();
  albumReturnFocus = trigger;
  const overlay = document.createElement('div'); overlay.className = 'album-viewer';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', albumIsVideo(file.name) ? '查看视频' : '查看照片');
  const close = document.createElement('button'); close.className = 'album-viewer-close'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭预览');
  close.addEventListener('click', closeAlbumViewer);
  const content = document.createElement('div'); content.className = 'album-viewer-content'; content.textContent = '正在加载…';
  overlay.append(close, content); overlay.addEventListener('click', e => { if (e.target === overlay) closeAlbumViewer(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeAlbumViewer(); });
  document.body.appendChild(overlay); document.body.classList.add('album-viewer-open'); albumDialog = overlay; close.focus();
  try {
    const url = await albumSignedUrl(file.path);
    if (albumDialog !== overlay) return;
    const video = albumIsVideo(file.name);
    const media = document.createElement(video ? 'video' : 'img');
    if (video) { media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
    else media.alt = '相册照片';
    media.addEventListener('error', () => { content.textContent = '无法显示此文件，请稍后重试。'; });
    media.src = url; content.replaceChildren(media);
  } catch (error) {
    console.error('无法打开相册文件', error);
    if (albumDialog === overlay) content.textContent = '无法打开，请检查网络后重试。';
  }
}
async function loadAlbumThumbnail(button, file, version) {
  if (albumIsVideo(file.name)) return; // Do not download every video while browsing the grid.
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  const showOriginal = async () => {
    try { const url = await albumSignedUrl(file.path); if (version === albumLoadVersion && button.isConnected) img.src = url; }
    catch { if (button.isConnected) button.classList.add('album-thumb-error'); }
  };
  try {
    const url = await albumSignedUrl(albumThumbnailPath(file.path));
    if (version !== albumLoadVersion || !button.isConnected) return;
    img.onerror = () => { img.onerror = () => button.classList.add('album-thumb-error'); showOriginal(); };
    img.src = url; button.prepend(img);
  } catch { button.prepend(img); await showOriginal(); }
}
async function loadAlbum(){
  const container = document.getElementById('album-grid'); const status = document.getElementById('album-status');
  if (!container || !currentUser) return;
  const userId = currentUser.id; const version = ++albumLoadVersion;
  albumObserver?.disconnect(); container.replaceChildren(); status.textContent = '正在打开相册…';
  try {
    const owners = [...new Set([userId, partnerProfile?.id].filter(Boolean))];
    const pages = await Promise.all(owners.map(id => sb.storage.from(ALBUM_BUCKET).list(id, {limit: 100, sortBy:{column:'created_at',order:'desc'}})));
    if (version !== albumLoadVersion || currentUser?.id !== userId) return;
    const failed = pages.find(p => p.error); if (failed) throw failed.error;
    const files = pages.flatMap((page, i) => (page.data || []).filter(f => f.id && f.name !== '.emptyFolderPlaceholder').map(f => ({...f, path:`${owners[i]}/${f.name}`, own:owners[i] === userId})));
    files.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if (!files.length) { status.textContent = '这里还没有照片或视频，留住第一个瞬间吧。'; return; }
    status.textContent = '';
    const pending = new Map();
    if ('IntersectionObserver' in window) albumObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const file = pending.get(entry.target); albumObserver.unobserve(entry.target); pending.delete(entry.target);
      if (file) loadAlbumThumbnail(entry.target, file, version);
    }), {rootMargin:'150px'});
    for (const f of files) {
      const card = document.createElement('article'); card.className = 'album-item';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'album-thumb';
      const video = albumIsVideo(f.name); button.setAttribute('aria-label', video ? '打开视频' : '打开照片');
      const placeholder = document.createElement('span'); placeholder.className = video ? 'album-play' : 'album-thumb-placeholder'; placeholder.textContent = video ? '▶' : '✳'; button.appendChild(placeholder);
      button.addEventListener('click', () => openAlbumViewer(f, button)); card.appendChild(button);
      const footer = document.createElement('div'); footer.className = 'album-item-footer';
      const date = document.createElement('span'); date.textContent = f.created_at ? new Date(f.created_at).toLocaleDateString('zh-CN') : ''; footer.appendChild(date);
      if(f.own){ const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'album-delete'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除这份照片或视频'); remove.addEventListener('click',()=>deleteAlbumFile(f.path)); footer.appendChild(remove); }
      card.appendChild(footer); container.appendChild(card);
      if (!video) { if (albumObserver) { pending.set(button, f); albumObserver.observe(button); } else loadAlbumThumbnail(button, f, version); }
    }
  } catch(error) { console.error('加载相册失败',error); if(version === albumLoadVersion) status.textContent = '相册暂时无法连接，请稍后重试。'; }
}
async function makeAlbumThumbnail(file) {
  if (!file.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  } finally { URL.revokeObjectURL(url); }
}
async function uploadAlbumFile(input){
  const file = input.files?.[0]; if(!file || albumBusy || !currentUser) return;
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
  const ext = extensions[file.type];
  if(!ext){ alert('请选择 JPG、PNG、WebP、HEIC、MP4、MOV 或 WebM 文件。'); input.value=''; return; }
  if(file.size > ALBUM_LIMIT){ alert('单个文件不能超过 50 MB。'); input.value=''; return; }
  albumBusy = true; const status = document.getElementById('album-status'); status.textContent = '正在上传，请保持页面打开…';
  try {
    const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
    const {error} = await sb.storage.from(ALBUM_BUCKET).upload(path, file, {contentType:file.type, upsert:false}); if(error) throw error;
    if(file.type.startsWith('image/')) {
      try { const thumb = await makeAlbumThumbnail(file); if(thumb) { const result = await sb.storage.from(ALBUM_BUCKET).upload(albumThumbnailPath(path), thumb, {contentType:'image/jpeg',upsert:false}); if(result.error) console.warn('缩略图生成失败', result.error); } }
      catch(error) { console.warn('无法生成缩略图',error); }
    }
    await loadAlbum();
  } catch(error){ console.error('上传失败',error); status.textContent = '上传失败，请检查网络或稍后再试。'; }
  finally { albumBusy = false; input.value = ''; }
}
async function deleteAlbumFile(path){
  if(!confirm('确定删除这份照片或视频吗？')) return;
  const paths = albumIsVideo(path) ? [path] : [path, albumThumbnailPath(path)];
  const {error} = await sb.storage.from(ALBUM_BUCKET).remove(paths);
  if(error) return alert('删除失败，请稍后重试。');
  await loadAlbum();
}
