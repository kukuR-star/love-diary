// Private files are stored in an RLS-protected bucket. Signed links expire after one hour.
const ALBUM_BUCKET = 'private-memories';
const ALBUM_LIMIT = 50 * 1024 * 1024;
let albumBusy = false;
async function loadAlbum(){
  const container = document.getElementById('album-grid');
  const status = document.getElementById('album-status');
  if (!container || !currentUser) return;
  container.replaceChildren();
  status.textContent = '正在打开相册…';
  try {
    const owners = [currentUser.id, partnerProfile?.id].filter(Boolean);
    const pages = await Promise.all(owners.map(id => sb.storage.from(ALBUM_BUCKET).list(id, {limit: 100, sortBy:{column:'created_at',order:'desc'}})));
    const failed = pages.find(p => p.error); if (failed) throw failed.error;
    const files = pages.flatMap((page, i) => (page.data || []).filter(f => f.id && f.name !== '.emptyFolderPlaceholder').map(f => ({...f, path: `${owners[i]}/${f.name}`, own: owners[i] === currentUser.id})));
    files.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(!files.length){ status.textContent = '这里还没有照片或视频，留住第一个瞬间吧。'; return; }
    status.textContent = '';
    for(const f of files){
      const {data, error} = await sb.storage.from(ALBUM_BUCKET).createSignedUrl(f.path, 3600);
      if(error || !data?.signedUrl) continue;
      const card = document.createElement('article'); card.className = 'album-item';
      const isVideo = f.name.endsWith('.mp4') || f.name.endsWith('.webm') || f.name.endsWith('.mov');
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.src = data.signedUrl;
      if(isVideo){ media.controls = true; media.preload = 'metadata'; }
      else { media.alt = '相册里的照片'; media.loading = 'lazy'; }
      card.appendChild(media);
      const footer = document.createElement('div'); footer.className = 'album-item-footer';
      const date = document.createElement('span'); date.textContent = new Date(f.created_at).toLocaleDateString('zh-CN'); footer.appendChild(date);
      if(f.own){ const button = document.createElement('button'); button.className = 'text-btn'; button.textContent = '删除'; button.addEventListener('click',()=>deleteAlbumFile(f.path)); footer.appendChild(button); }
      card.appendChild(footer); container.appendChild(card);
    }
    if(!container.children.length) status.textContent = '暂时无法加载相册，请稍后重试。';
  }catch(error){ console.error('加载相册失败', error); status.textContent = '相册暂时无法连接，请稍后重试。'; }
}
async function uploadAlbumFile(input){
  const file = input.files?.[0]; if(!file || albumBusy || !currentUser) return;
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
  const ext = extensions[file.type];
  if(!ext){ alert('请选择 JPG、PNG、WebP、HEIC、MP4、MOV 或 WebM 文件。'); input.value=''; return; }
  if(file.size > ALBUM_LIMIT){ alert('单个文件不能超过 50 MB。'); input.value=''; return; }
  albumBusy = true;
  const status = document.getElementById('album-status'); status.textContent = '正在上传，请保持页面打开…';
  try {
    const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
    const {error} = await sb.storage.from(ALBUM_BUCKET).upload(path, file, {contentType:file.type, upsert:false});
    if(error) throw error;
    await loadAlbum();
  }catch(error){ console.error('上传失败',error); status.textContent = '上传失败，请检查网络或稍后再试。'; }
  finally { albumBusy = false; input.value = ''; }
}
async function deleteAlbumFile(path){
  if(!confirm('确定删除这份照片或视频吗？')) return;
  const {error} = await sb.storage.from(ALBUM_BUCKET).remove([path]);
  if(error) return alert('删除失败，请稍后重试。');
  await loadAlbum();
}
