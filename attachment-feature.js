// Private chat pictures: originals and small previews remain in the existing private bucket.
const CHAT_IMAGE_BUCKET = 'private-memories';
const CHAT_IMAGE_LIMIT = 50 * 1024 * 1024;
const CHAT_IMAGE_MAX_FILES = 9;
const CHAT_IMAGE_TYPES = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'};
let chatImageViewer = null;

function validateChatImages(files) {
  const list = Array.from(files || []);
  if (list.length > CHAT_IMAGE_MAX_FILES) throw new Error(`一次最多选择 ${CHAT_IMAGE_MAX_FILES} 张照片。`);
  for (const file of list) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!CHAT_IMAGE_TYPES[file.type] && !(!file.type && ['jpg','jpeg','png','webp','heic'].includes(ext))) throw new Error('请选择 JPG、PNG、WebP 或 HEIC 照片。');
    if (file.size > CHAT_IMAGE_LIMIT) throw new Error('每张照片不能超过 50 MB。');
  }
  return list;
}
async function uploadChatAttachments(files, diaryId, commentId = null) {
  const items = validateChatImages(files);
  if (!items.length) return [];
  if (!currentUser || !diaryId) throw new Error('请先登录并保存内容。');
  const uid = currentUser.id;
  const uploaded = [];
  try {
    const rows = [];
    for (const file of items) {
      if (currentUser?.id !== uid) throw new Error('账号状态已改变。');
      const fallback = (file.name.split('.').pop() || '').toLowerCase();
      const ext = CHAT_IMAGE_TYPES[file.type] || (fallback === 'jpeg' ? 'jpg' : fallback);
      const path = `${uid}/.chat/${crypto.randomUUID()}.${ext}`;
      const mime = file.type || ({jpg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic'}[ext]);
      const result = await sb.storage.from(CHAT_IMAGE_BUCKET).upload(path,file,{contentType:mime,upsert:false});
      if(result.error) throw result.error;
      uploaded.push(path);
      let thumbnailPath = null;
      if (typeof makeAlbumThumbnail === 'function') {
        try {
          const thumb = await makeAlbumThumbnail(file);
          if (thumb) {
            const candidate = `${uid}/.chat-thumbs/${crypto.randomUUID()}.jpg`;
            const result = await sb.storage.from(CHAT_IMAGE_BUCKET).upload(candidate,thumb,{contentType:'image/jpeg',upsert:false});
            if(!result.error){ thumbnailPath=candidate; uploaded.push(candidate); }
          }
        } catch (error) { console.warn('预览图生成失败',error); }
      }
      rows.push({diary_id:diaryId,comment_id:commentId,owner_id:uid,object_path:path,thumbnail_path:thumbnailPath});
    }
    const {data,error} = await sb.from('chat_attachments').insert(rows).select('id');
    if (error) throw error;
    return data || [];
  } catch (error) {
    if (uploaded.length) {
      const cleanup = await sb.storage.from(CHAT_IMAGE_BUCKET).remove(uploaded);
      if (cleanup.error) console.error('上传失败后清理照片失败',cleanup.error);
    }
    throw error;
  }
}
function closeChatImageViewer() {
  if (!chatImageViewer) return;
  const old = chatImageViewer; chatImageViewer = null; old.remove(); document.body.classList.remove('chat-image-open');
}
async function showChatImage(row) {
  closeChatImageViewer();
  const overlay = document.createElement('div'); overlay.className='chat-image-viewer'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','查看图片');
  const close = document.createElement('button'); close.type='button'; close.textContent='×'; close.setAttribute('aria-label','关闭图片'); close.addEventListener('click',closeChatImageViewer);
  const status = document.createElement('span'); status.textContent='加载中…';
  overlay.append(close,status); overlay.addEventListener('click',e=>{if(e.target===overlay)closeChatImageViewer()}); overlay.addEventListener('keydown',e=>{if(e.key==='Escape')closeChatImageViewer()});
  document.body.append(overlay); document.body.classList.add('chat-image-open'); chatImageViewer=overlay; close.focus();
  try {
    const {data,error} = await sb.storage.from(CHAT_IMAGE_BUCKET).createSignedUrl(row.object_path,600);
    if(error || !data?.signedUrl) throw error || new Error('无法获取图片');
    if(chatImageViewer!==overlay)return;
    const img=document.createElement('img'); img.alt='照片'; img.src=data.signedUrl; img.onerror=()=>{img.remove();status.textContent='图片加载失败';overlay.append(status);}; overlay.append(img); status.remove();
  } catch(error) { console.error(error); if(chatImageViewer===overlay)status.textContent='图片加载失败'; }
}
async function renderChatAttachments(diaryId, container, commentId = null) {
  if (!currentUser || !container) return;
  let query=sb.from('chat_attachments').select('id,diary_id,comment_id,owner_id,object_path,thumbnail_path,created_at').eq('diary_id',diaryId).order('created_at');
  query = commentId ? query.eq('comment_id',commentId) : query.is('comment_id',null);
  const {data,error}=await query;
  if(error){ console.error('图片加载失败',error); return; }
  if(!container.isConnected)return;
  container.replaceChildren();
  for(const row of data || []) {
    const button=document.createElement('button'); button.type='button';button.className='chat-image-thumb';button.setAttribute('aria-label','查看照片');
    button.textContent='照片'; button.addEventListener('click',()=>showChatImage(row)); container.append(button);
    try {
      const {data:link,error:err}=await sb.storage.from(CHAT_IMAGE_BUCKET).createSignedUrl(row.thumbnail_path || row.object_path,600);
      if(err||!link?.signedUrl||!button.isConnected)continue;
      const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';img.src=link.signedUrl;button.replaceChildren(img);
    } catch(e) { console.error('图片预览失败',e); }
  }
}
// Must be called before parent deletion because metadata uses RESTRICT, to avoid leaving files orphaned.
// If another user's attachments exist, return false and leave them intact.
async function removeChatAttachments(diaryId, commentId = null) {
  if(!currentUser)return false;
  let query=sb.from('chat_attachments').select('id,owner_id,object_path,thumbnail_path').eq('diary_id',diaryId);
  if(commentId) query=query.eq('comment_id',commentId);
  const {data,error}=await query;if(error)throw error;
  if((data||[]).some(row=>row.owner_id!==currentUser.id))return false;
  for(const row of data||[]) {
    const paths=[row.object_path,row.thumbnail_path].filter(Boolean);
    const removed=await sb.storage.from(CHAT_IMAGE_BUCKET).remove(paths);if(removed.error)throw removed.error;
    const deleted=await sb.from('chat_attachments').delete().eq('id',row.id).eq('owner_id',currentUser.id);if(deleted.error)throw deleted.error;
  }
  return true;
}
