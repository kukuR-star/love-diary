// The original files and thumbnails stay in a private bucket; signed URLs expire.
const ALBUM_BUCKET = 'private-memories';
const ALBUM_LIMIT = 50 * 1024 * 1024;
let albumBusy = false;
let albumLoadVersion = 0;
let albumObserver = null;
let albumDialog = null;
let albumReturnFocus = null;
let albumCategory = '全部';
let albumCategories = new Map();
const ALBUM_DEFAULT_CATEGORIES = ['合照', '旅行', '生活'];
// URL cache is memory-only and shorter lived than the signed URL itself.
const albumUrlCache = new Map();
const albumThumbnailWrites = new Set();

function initAlbumControls() {
  const grid = document.getElementById('album-grid');
  const input = document.querySelector('#panel-album input[type=file]');
  if (!grid || !input) return;
  input.multiple = true;
  // Separate inputs keep iOS Photos picker in image-multiple mode instead of
  // mixing image and video UTIs. The system camera itself remains single-shot.
  if (!document.getElementById('album-video-input')) {
    const imageLabel = input.closest('label');
    if (imageLabel) {
      imageLabel.replaceChildren(document.createTextNode('选择照片'), input);
      input.accept = 'image/*';
      const videoLabel = document.createElement('label');
      videoLabel.className = 'album-upload album-video-upload';
      videoLabel.appendChild(document.createTextNode('选择视频'));
      const videoInput = document.createElement('input');
      videoInput.id = 'album-video-input'; videoInput.type = 'file';
      videoInput.accept = 'video/*'; videoInput.multiple = true;
      videoInput.addEventListener('change', () => uploadAlbumFile(videoInput));
      videoLabel.appendChild(videoInput); imageLabel.after(videoLabel);
    }
  }
  if (document.getElementById('album-filters')) return;
  const wrapper = document.createElement('div'); wrapper.className = 'album-controls'; wrapper.id = 'album-filters';
  const label = document.createElement('label'); label.textContent = '查看分类';
  const filter = document.createElement('select'); filter.id = 'album-category-filter'; filter.setAttribute('aria-label', '查看相册分类');
  filter.addEventListener('change', () => { albumCategory = filter.value; loadAlbum(); });
  label.appendChild(filter);
  const uploadLabel = document.createElement('label'); uploadLabel.textContent = '添加到';
  const uploadCategory = document.createElement('select'); uploadCategory.id = 'album-upload-category'; uploadCategory.setAttribute('aria-label', '上传到哪个分类');
  uploadLabel.appendChild(uploadCategory);
  wrapper.append(label,uploadLabel); grid.before(wrapper);
}
function updateAlbumCategoryOptions() {
  const filter = document.getElementById('album-category-filter');
  const upload = document.getElementById('album-upload-category');
  if(!filter || !upload) return;
  const previous = upload.value;
  const categories = [...new Set([...ALBUM_DEFAULT_CATEGORIES, ...albumCategories.values()].filter(Boolean))].sort();
  function fill(select, values, chosen) {
    select.replaceChildren();
    for (const [value, text] of values) { const opt = document.createElement('option'); opt.value = value; opt.textContent = text; select.appendChild(opt); }
    if ([...select.options].some(o => o.value === chosen)) select.value = chosen;
  }
  fill(filter, [['全部','全部'], ['未分类','未分类'], ...categories.map(c => [c,c])], albumCategory);
  fill(upload, [['','未分类'], ...categories.map(c => [c,c]), ['__new__','＋ 新建分类']], previous);
  upload.onchange = () => {
    if (upload.value !== '__new__') return;
    const name = prompt('输入新分类名称（最多 30 个字）');
    const clean = (name || '').trim();
    if (!clean || clean.length > 30 || ['全部','未分类','__new__'].includes(clean)) { upload.value = ''; if(clean) alert('分类名称无效，请重新输入。'); return; }
    const option = document.createElement('option'); option.value = clean; option.textContent = clean; upload.insertBefore(option, upload.lastElementChild); upload.value = clean;
  };
}
async function setAlbumCategory(file) {
  const existing = albumCategories.get(file.path) || '';
  const value = prompt('输入分类名称，留空则移至未分类：', existing);
  if (value === null) return;
  const category = value.trim();
  if (category.length > 30 || ['全部','未分类','__new__'].includes(category)) return alert('分类名称无效，请重新输入。');
  const query = category ? sb.from('album_media_categories').upsert({object_path:file.path,owner_id:currentUser.id,category}) : sb.from('album_media_categories').delete().eq('object_path',file.path).eq('owner_id',currentUser.id);
  const {error} = await query;
  if(error) return alert('分类保存失败，请稍后重试。');
  await loadAlbum();
}

function albumThumbnailPath(path) {
  const slash = path.indexOf('/');
  return `${path.slice(0, slash)}/.thumbs/${path.slice(slash + 1)}.jpg`;
}
async function albumSignedUrl(path) {
  const key = `${currentUser?.id || ''}:${path}`;
  const cached = albumUrlCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;
  const {data, error} = await sb.storage.from(ALBUM_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw error || new Error('无法获取文件');
  albumUrlCache.set(key, {url:data.signedUrl, expires:Date.now() + 55 * 60 * 1000});
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
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.crossOrigin = 'anonymous';
  const showOriginal = async () => {
    try {
      const url = await albumSignedUrl(file.path);
      if (version !== albumLoadVersion || !button.isConnected) return;
      // Build a private thumbnail once for existing own photos. A failed CORS,
      // conversion or upload never blocks showing the original.
      img.onload = () => {
        if (!file.own || albumThumbnailWrites.has(file.path)) return;
        albumThumbnailWrites.add(file.path);
        saveLegacyThumbnail(img, file.path).catch(() => albumThumbnailWrites.delete(file.path));
      };
      img.src = url;
    } catch { if (button.isConnected) button.classList.add('album-thumb-error'); }
  };
  try {
    const url = await albumSignedUrl(albumThumbnailPath(file.path));
    if (version !== albumLoadVersion || !button.isConnected) return;
    img.onerror = () => { img.onerror = () => button.classList.add('album-thumb-error'); showOriginal(); };
    img.src = url; button.prepend(img);
  } catch { button.prepend(img); await showOriginal(); }
}
async function listAlbumOwner(owner) {
  const files = [];
  const size = 100;
  for (let offset = 0; ; offset += size) {
    const {data, error} = await sb.storage.from(ALBUM_BUCKET).list(owner, {limit:size, offset, sortBy:{column:'created_at',order:'desc'}});
    if (error) return {data:null, error};
    files.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return {data:files, error:null};
}
async function loadAlbum(){
  const container = document.getElementById('album-grid'); const status = document.getElementById('album-status');
  if (!container || !currentUser) return;
  initAlbumControls();
  const userId = currentUser.id; const version = ++albumLoadVersion;
  albumObserver?.disconnect(); container.replaceChildren(); status.textContent = '正在打开相册…';
  try {
    const owners = [...new Set([userId, partnerProfile?.id].filter(Boolean))];
    const [pages, categoryResult] = await Promise.all([Promise.all(owners.map(listAlbumOwner)), sb.from('album_media_categories').select('object_path,category')]);
    if (categoryResult.error) throw categoryResult.error;
    albumCategories = new Map((categoryResult.data || []).map(row => [row.object_path,row.category]));
    updateAlbumCategoryOptions();
    if (version !== albumLoadVersion || currentUser?.id !== userId) return;
    const failed = pages.find(p => p.error); if (failed) throw failed.error;
    let files = pages.flatMap((page, i) => (page.data || []).filter(f => f.id && f.name !== '.emptyFolderPlaceholder').map(f => ({...f, path:`${owners[i]}/${f.name}`, own:owners[i] === userId})));
    files.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if (albumCategory !== '全部') files = files.filter(f => (albumCategories.get(f.path) || '未分类') === albumCategory);
    if (!files.length) { status.textContent = albumCategory === '全部' ? '这里还没有照片或视频，留住第一个瞬间吧。' : '这个分类里还没有照片或视频。'; return; }
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
      if(f.own){ const categorize = document.createElement('button'); categorize.type='button'; categorize.className='album-categorize'; categorize.textContent='分类'; categorize.setAttribute('aria-label','修改分类'); categorize.addEventListener('click',()=>setAlbumCategory(f)); footer.appendChild(categorize); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'album-delete'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除这份照片或视频'); remove.addEventListener('click',()=>deleteAlbumFile(f.path)); footer.appendChild(remove); }
      card.appendChild(footer); container.appendChild(card);
      if (!video) { if (albumObserver) { pending.set(button, f); albumObserver.observe(button); } else loadAlbumThumbnail(button, f, version); }
    }
  } catch(error) { console.error('加载相册失败',error); if(version === albumLoadVersion) status.textContent = '相册暂时无法连接，请稍后重试。'; }
}
async function saveLegacyThumbnail(img, path) {
  const scale = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
  if (!Number.isFinite(scale) || scale <= 0) return;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  if (!blob) return;
  const {error} = await sb.storage.from(ALBUM_BUCKET).upload(albumThumbnailPath(path), blob, {contentType:'image/jpeg', upsert:false});
  if (error) throw error;
}
async function makeAlbumThumbnail(file) {
  // Caller already validated a supported image MIME, including iOS files with an empty type.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const scale = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  } finally { URL.revokeObjectURL(url); }
}
async function uploadAlbumFile(input){
  const files = Array.from(input.files || []); if(!files.length || albumBusy || !currentUser) return;
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
  const selected = document.getElementById('album-upload-category')?.value || '';
  const category = selected === '__new__' ? '' : selected;
  const status = document.getElementById('album-status');
  albumBusy = true; input.disabled = true;
  let uploaded = 0, failed = 0, uncategorized = 0;
  try {
    for (let i=0; i<files.length; i++) {
      const file=files[i];
      const fallbackTypes = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'};
      const extension = file.name.split('.').pop().toLowerCase();
      const mime = file.type || fallbackTypes[extension] || '';
      const ext=extensions[mime];
      status.textContent = `正在处理 ${i+1} / ${files.length}…`;
      if(!ext || file.size>ALBUM_LIMIT) { failed++; continue; }
      try {
        const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
        const {error} = await sb.storage.from(ALBUM_BUCKET).upload(path,file,{contentType:mime,upsert:false});
        if(error) throw error;
        uploaded++;
        if(category){
          const result = await sb.from('album_media_categories').insert({object_path:path,owner_id:currentUser.id,category});
          if(result.error){ console.warn('分类保存失败',result.error); uncategorized++; }
        }
        if(mime.startsWith('image/')) {
          try { const thumb=await makeAlbumThumbnail(file); if(thumb) { const result=await sb.storage.from(ALBUM_BUCKET).upload(albumThumbnailPath(path),thumb,{contentType:'image/jpeg',upsert:false}); if(result.error) console.warn('缩略图上传失败',result.error); } }
          catch(error){ console.warn('缩略图生成失败',error); }
        }
      } catch(error) { console.error('上传失败',error); failed++; }
    }
    albumCategory = category || '全部';
    await loadAlbum();
    status.textContent = `已上传 ${uploaded} 项${failed ? `，${failed} 项失败（请检查格式、网络和 50 MB 限制）` : ''}${uncategorized ? `，${uncategorized} 项未能保存分类` : ''}。`;
  } finally { albumBusy = false; input.disabled = false; input.value = ''; }
}

async function deleteAlbumFile(path){
  if(!confirm('确定删除这份照片或视频吗？')) return;
  const paths = albumIsVideo(path) ? [path] : [path, albumThumbnailPath(path)];
  albumThumbnailWrites.delete(path);
  for (const item of paths) albumUrlCache.delete(`${currentUser?.id || ''}:${item}`);
  const {error} = await sb.storage.from(ALBUM_BUCKET).remove(paths);
  if(error) return alert('删除失败，请稍后重试。');
  const cleanup = await sb.from('album_media_categories').delete().eq('object_path',path).eq('owner_id',currentUser.id);
  if (cleanup.error) console.warn('分类记录清理失败', cleanup.error);
  await loadAlbum();
}
