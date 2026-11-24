// Shared text / voice / emoji / photo input chrome. Files are kept in memory
// until the caller saves them. The caller owns uploading and persistence.
(() => {
  const state = new Map();
  const emoji = ['😊','🥰','😂','😍','🥹','😚','🥳','😴','😭','😠','❤️','💕','🌸','✨','🎉','🌙','☀️','🍰','☕','🫶','👍','🤗','😘','🐱'];
  const icons = {
    face:'<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8 14c1 2 2.5 3 4 3s3-1 4-3"/>',
    plus:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  function entry(key){if(!state.has(key))state.set(key,{files:[], urls:[], preview:null});return state.get(key);}
  function renderPreview(key){
    const item=entry(key), root=item.preview; item.sync?.(); if(!root?.isConnected)return;
    root.replaceChildren();root.hidden=!item.files.length;
    item.files.forEach((file,index)=>{
      const tile=document.createElement('div');tile.className='chat-attachment';
      const img=document.createElement('img');img.alt='待发送的照片';img.src=item.urls[index];
      const remove=document.createElement('button');remove.type='button';remove.className='chat-attachment-remove';remove.textContent='×';remove.setAttribute('aria-label',`移除第 ${index+1} 张照片`);
      remove.addEventListener('click',()=>{URL.revokeObjectURL(item.urls[index]);item.urls.splice(index,1);item.files.splice(index,1);renderPreview(key)});
      tile.append(img,remove);root.append(tile);
    });
  }
  function decorate(key,row,input,voice,send,placeAfter){
    if(!row || !input || !voice || !send || row.dataset.chatComposer==='1')return false;
    row.dataset.chatComposer='1';row.classList.add('chat-composer');
    const extras=document.createElement('div');extras.className='chat-extra-controls';
    const face=document.createElement('button');face.type='button';face.className='chat-icon-button';face.setAttribute('aria-label','选择表情');face.setAttribute('aria-expanded','false');face.innerHTML=icon('face');
    const add=document.createElement('label');add.className='chat-icon-button chat-add';add.setAttribute('aria-label','添加照片');add.setAttribute('role','button');add.tabIndex=0;add.innerHTML=icon('plus');
    const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/*';fileInput.multiple=true;fileInput.setAttribute('aria-label','选择照片');add.append(fileInput);add.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fileInput.click();}});
    extras.append(face);row.insertBefore(extras,send);row.insertBefore(add,send);
    const panel=document.createElement('div');panel.className='chat-emoji-panel';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','表情');
    for(const value of emoji){const b=document.createElement('button');b.type='button';b.textContent=value;b.setAttribute('aria-label',value);b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>{const start=input.selectionStart ?? input.value.length,end=input.selectionEnd ?? start;input.setRangeText(value,start,end,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});panel.append(b);}
    const sync=()=>{ if(!send.dataset.busy) send.disabled=!(input.value.trim() || entry(key).files.length); };
    entry(key).sync=sync; input.addEventListener('input',sync); sync();
    input.addEventListener('keydown',e=>{if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){e.preventDefault();if(!send.disabled)send.click();}});
    const previews=document.createElement('div');previews.className='chat-attachments';previews.hidden=true;
    const after=placeAfter || row;after.after(panel);panel.after(previews);entry(key).preview=previews;renderPreview(key);
    face.addEventListener('click',()=>{panel.hidden=!panel.hidden;face.setAttribute('aria-expanded',String(!panel.hidden));});
    fileInput.addEventListener('change',()=>{const files=[...fileInput.files||[]];const e=entry(key);let skipped=0;for(const file of files){if((file.type && !file.type.startsWith('image/')) || e.files.length>=9){skipped++;continue;}e.files.push(file);e.urls.push(URL.createObjectURL(file));}fileInput.value='';renderPreview(key);if(skipped)alert('每条最多添加 9 张照片，请检查文件类型。');});
    return true;
  }
  window.ChatComposer = {
    mountDiary(){
      const input=document.getElementById('diary-content'),shell=document.getElementById('diary-voice-composer');
      const voice=shell?.querySelector('.voice-mode-toggle'),send=document.querySelector('button[onclick="saveDiary()"]');
      if(!input||!shell||!voice||!send||document.getElementById('diary-chat-row'))return;
      const row=document.createElement('div');row.id='diary-chat-row';const hold=document.querySelector('#panel-diary .voice-hold');shell.before(row);row.append(voice,input);if(hold)row.append(hold);row.append(send);
      decorate('diary',row,input,voice,send,shell);
    },
    mountComment(diaryId){
      const row=document.getElementById(`comment-${diaryId}`)?.querySelector('.comment-input-box');
      if(!row)return;let input=document.getElementById(`comment-input-${diaryId}`);const voice=row.querySelector('.voice-mode-toggle');
      if(input && input.tagName==='INPUT') {const area=document.createElement('textarea');area.id=input.id;area.placeholder=input.placeholder;area.rows=1;area.value=input.value;input.replaceWith(area);input=area;}
      const send=row.querySelector('button[onclick^="sendComment"]');
      decorate(diaryId,row,input,voice,send,row);
    },
    getFiles(key){return [...entry(key).files]},
    sync(key){entry(key).sync?.()},
    clear(key){const e=entry(key);e.urls.forEach(url=>URL.revokeObjectURL(url));e.files=[];e.urls=[];renderPreview(key)},
    clearAll(){for(const key of state.keys())this.clear(key);state.clear()}
  };
})();
