// Voice notes are stored privately; real-time dictation is optional and browser dependent.
const VOICE_BUCKET = 'private-voice-comments';
let activeVoiceRecording = null;
let activeSpeechRecognition = null;

function stopVoiceRecording() {
  const active = activeVoiceRecording;
  if (active?.recorder.state === 'recording') active.recorder.stop();
  active?.stream.getTracks().forEach(track => track.stop());
  if (activeSpeechRecognition) { try { activeSpeechRecognition.stop(); } catch {} activeSpeechRecognition = null; }
}
window.addEventListener('pagehide', stopVoiceRecording);

async function renderVoiceComments(diaryId, mount) {
  if (!mount || !currentUser) return;
  const uid = currentUser.id;
  mount.replaceChildren();
  const section = document.createElement('section'); section.className = 'voice-section';
  const heading = document.createElement('div'); heading.className = 'voice-heading'; heading.textContent = '';
  const list = document.createElement('div'); list.className = 'voice-list';
  const status = document.createElement('p'); status.className = 'voice-status'; status.setAttribute('role', 'status');
  const recorderButton = document.createElement('button'); recorderButton.type = 'button'; recorderButton.className = 'voice-button'; recorderButton.textContent = '点击录音';
  const transcript = document.createElement('textarea'); transcript.className = 'voice-transcript'; transcript.placeholder = '可填写或编辑语音文字'; transcript.maxLength = 2000; transcript.hidden = true;
  const dictated = document.createElement('button'); dictated.type = 'button'; dictated.className = 'voice-dictate'; dictated.textContent = '实时听写'; dictated.hidden = true;
  const send = document.createElement('button'); send.type = 'button'; send.className = 'voice-send'; send.textContent = '发送语音'; send.hidden = true;
  const preview = document.createElement('audio'); preview.controls = true; preview.hidden = true;
  let previewUrl = null;
  function clearPreview(){ if(previewUrl) URL.revokeObjectURL(previewUrl); previewUrl=null; preview.hidden=true; preview.removeAttribute('src'); }
  const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'voice-discard'; discard.textContent = '取消'; discard.hidden = true;
  const note = document.createElement('p'); note.className = 'voice-note'; note.textContent = '最长 60 秒。实时听写依赖浏览器，可能使用第三方识别服务；也可以手动填写文字。';
  const actions = document.createElement('div'); actions.className = 'voice-actions'; actions.append(recorderButton, preview, dictated, send, discard);
  section.append(list,actions,transcript,note,status); mount.append(section);
  const inputRow = mount.parentElement.querySelector('.comment-input-box');
  let modeToggle = inputRow.querySelector('.voice-mode-toggle');
  if (!modeToggle) { modeToggle=document.createElement('button'); modeToggle.type='button'; modeToggle.className='voice-mode-toggle'; inputRow.prepend(modeToggle); }
  const textInput = inputRow.querySelector('input'); const textSend = inputRow.querySelector('button[onclick^="sendComment"]');
  let voiceMode = false;
  function setMode(voice) {
    voiceMode=voice; modeToggle.textContent=voice ? '⌨' : '◉'; modeToggle.setAttribute('aria-label',voice ? '切换文字输入' : '切换语音输入');
    textInput.hidden=voice; textSend.hidden=voice; actions.hidden=!voice; transcript.hidden=true; note.hidden=!voice;
    if (!voice) { recordingId++; stopVoiceRecording(); blob=null; clearPreview(); recorderButton.textContent='点击录音'; send.hidden=true; discard.hidden=true; }
  }
  let blob = null; let recordingId = 0;
  modeToggle.onclick=()=>setMode(!voiceMode); setMode(false);
  async function load() {
    const {data, error} = await sb.from('voice_comments').select('id,owner_id,audio_path,transcript,created_at').eq('diary_id',diaryId).order('created_at');
    if (!section.isConnected || currentUser?.id !== uid) return;
    list.replaceChildren();
    if (error) { status.textContent = '语音留言暂时无法加载。'; console.error(error); return; }
    for (const item of data || []) {
      const row = document.createElement('div'); row.className = 'voice-item';
      const name = document.createElement('span'); name.className = 'voice-author'; name.textContent = item.owner_id === uid ? '我' : (authorMap[item.owner_id]?.nickname || partnerProfile?.nickname || 'TA');
      const play = document.createElement('button'); play.type = 'button'; play.className = 'voice-play'; play.textContent = '▶ 播放语音';
      play.addEventListener('click', async () => {
        play.disabled = true;
        try { const result = await sb.storage.from(VOICE_BUCKET).createSignedUrl(item.audio_path, 600); if(result.error) throw result.error;
          const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = result.data.signedUrl; play.replaceWith(audio); await audio.play().catch(()=>{});
        } catch(e) { console.error(e); status.textContent='语音暂时无法播放。'; play.disabled=false; }
      });
      row.append(name,play);
      if (item.owner_id === uid) {
        const remove = document.createElement('button'); remove.type='button'; remove.className='voice-remove'; remove.textContent='删除';
        remove.addEventListener('click', async () => {
          if (!confirm('确定删除这条语音留言吗？')) return;
          remove.disabled=true;
          try {
            const deleted = await sb.from('voice_comments').delete().eq('id',item.id).eq('owner_id',uid).select('id');
            if(deleted.error) throw deleted.error;
            if(!deleted.data?.length) throw new Error('留言不存在或没有删除权限');
            const storage = await sb.storage.from(VOICE_BUCKET).remove([item.audio_path]);
            if(storage.error) { console.error('音频清理失败',storage.error); status.textContent='留言已删除，但音频文件清理失败，请联系管理员。'; }
            await load(); if(typeof refreshCommentCounts === 'function') await refreshCommentCounts();
          } catch(error) { console.error(error); status.textContent='删除失败，请稍后重试。'; remove.disabled=false; }
        });
        row.append(remove);
      }
      if (item.transcript) { const text = document.createElement('p'); text.className = 'voice-text'; text.textContent = item.transcript; row.append(text); }
      list.append(row);
    }
  }
  recorderButton.addEventListener('click', async () => {
    if (activeVoiceRecording) { if (activeVoiceRecording.mount === mount) stopVoiceRecording(); else status.textContent='请先完成正在录制的语音。'; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status.textContent='当前浏览器不支持录音。'; return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      if(!section.isConnected || currentUser?.id !== uid) { stream.getTracks().forEach(t=>t.stop()); return; }
      const type = ['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = type ? new MediaRecorder(stream, {mimeType:type}) : new MediaRecorder(stream);
      const chunks = []; const thisRecording = ++recordingId;
      recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { status.textContent = '录音失败，请重试。'; };
      recorder.onstop = () => {
        stream.getTracks().forEach(t=>t.stop()); clearTimeout(activeVoiceRecording?.timer); activeVoiceRecording = null;
        if (thisRecording !== recordingId || !section.isConnected) return;
        blob = new Blob(chunks,{type:recorder.mimeType || type || 'audio/mp4'});
        if (!blob.size) { status.textContent='没有录到声音，请重试。'; recorderButton.textContent='点击录音'; return; }
        clearPreview(); previewUrl=URL.createObjectURL(blob); preview.src=previewUrl; preview.hidden=false;
        recorderButton.textContent='重新录制'; transcript.hidden = false; send.hidden=false; discard.hidden=false; dictated.hidden=true; status.textContent='录制完成，可编辑文字后发送。';
      };
      recorder.start();
      activeVoiceRecording = {recorder, stream, mount, timer:setTimeout(stopVoiceRecording,60000)};
      blob=null; clearPreview(); transcript.value=''; transcript.hidden=false; send.hidden=true; discard.hidden=true;
      dictated.hidden=!(window.SpeechRecognition || window.webkitSpeechRecognition);
      recorderButton.textContent='停止录音'; status.textContent='正在录音… 最长 60 秒';
    } catch(e) { stream?.getTracks().forEach(t=>t.stop()); console.error(e); status.textContent='无法使用麦克风，请检查 Safari 的麦克风权限。'; }
  });
  dictated.addEventListener('click', () => {
    if (!activeVoiceRecording || activeVoiceRecording.mount !== mount) return;
    if(activeSpeechRecognition) { activeSpeechRecognition.stop(); activeSpeechRecognition=null; dictated.textContent='实时听写'; return; }
    if(!confirm('实时听写由浏览器提供，语音可能发送至浏览器的识别服务。是否继续？')) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      const recognition = new Recognition(); recognition.lang='zh-CN'; recognition.continuous=true; recognition.interimResults=false;
      recognition.onresult = event => { for(let i=event.resultIndex;i<event.results.length;i++) if(event.results[i].isFinal) transcript.value += event.results[i][0].transcript; };
      recognition.onerror = () => { status.textContent='实时听写不可用，可继续录音并手动填写文字。'; };
      recognition.onend = () => { if(activeSpeechRecognition === recognition) activeSpeechRecognition=null; dictated.textContent='实时听写'; };
      recognition.start(); activeSpeechRecognition=recognition; dictated.textContent='停止听写';
    } catch(e) { console.error(e); status.textContent='实时听写不可用，可手动填写文字。'; }
  });
  discard.addEventListener('click', () => { recordingId++; stopVoiceRecording(); blob=null; clearPreview(); transcript.value=''; transcript.hidden=true; send.hidden=true; discard.hidden=true; dictated.hidden=true; recorderButton.textContent='点击录音'; status.textContent=''; });
  send.addEventListener('click', async () => {
    if(!blob || currentUser?.id !== uid) return;
    if (window.ChatComposer?.getFiles(diaryId).length) { status.textContent = '请先用文字模式发送照片，再发送语音。'; return; }
    send.disabled=true; recorderButton.disabled=true; status.textContent='正在发送…';
    const extension = blob.type.includes('webm') ? 'webm' : 'm4a'; const path = `${uid}/${crypto.randomUUID()}.${extension}`;
    let uploaded=false;
    try {
      const upload=await sb.storage.from(VOICE_BUCKET).upload(path,blob,{contentType:blob.type.split(';')[0],upsert:false}); if(upload.error) throw upload.error; uploaded=true;
      const result=await sb.from('voice_comments').insert({diary_id:diaryId,owner_id:uid,audio_path:path,transcript:transcript.value.trim() || null}); if(result.error) throw result.error;
      blob=null; clearPreview(); transcript.value=''; transcript.hidden=true; send.hidden=true; discard.hidden=true; recorderButton.textContent='点击录音'; status.textContent=''; await load();
      if (typeof refreshCommentCounts === 'function') await refreshCommentCounts();
    } catch(e) { if(uploaded) await sb.storage.from(VOICE_BUCKET).remove([path]); console.error(e); status.textContent='发送失败，请检查网络后重试。'; }
    finally { send.disabled=false; recorderButton.disabled=false; }
  });
  await load();
}

// Diary voice notes use their own metadata table and the same private audio bucket.
function initDiaryVoiceComposer() {
  const text = document.getElementById('diary-content');
  const save = document.querySelector('button[onclick="saveDiary()"]');
  if (!text || !save || document.getElementById('diary-voice-composer')) return;
  const shell = document.createElement('div'); shell.id='diary-voice-composer'; shell.className='diary-voice-composer';
  const toggle = document.createElement('button'); toggle.type='button'; toggle.className='voice-mode-toggle';
  const actions = document.createElement('div'); actions.className='voice-actions'; actions.hidden=true;
  const record = document.createElement('button'); record.type='button'; record.className='voice-button'; record.textContent='点击录音';
  const preview = document.createElement('audio'); preview.controls=true; preview.hidden=true;
  const cancel = document.createElement('button'); cancel.type='button'; cancel.className='voice-discard'; cancel.textContent='取消'; cancel.hidden=true;
  const submit = document.createElement('button'); submit.type='button'; submit.className='voice-send'; submit.textContent='保存日记'; submit.hidden=true;
  const status = document.createElement('p'); status.className='voice-status'; status.setAttribute('role','status');
  actions.append(record,preview,cancel,submit); shell.append(toggle,actions,status); text.before(shell);
  let voiceMode=false, blob=null, previewUrl=null, token=0;
  const clearPreview=()=>{ if(previewUrl) URL.revokeObjectURL(previewUrl); previewUrl=null; preview.hidden=true; preview.removeAttribute('src'); };
  function setMode(voice) { voiceMode=voice; toggle.textContent=voice?'⌨':'◉'; toggle.setAttribute('aria-label',voice?'切换文字输入':'切换语音输入'); text.hidden=voice; save.hidden=voice; actions.hidden=!voice; if(!voice) { token++; stopVoiceRecording(); blob=null; clearPreview(); record.textContent='点击录音'; submit.hidden=true; cancel.hidden=true; status.textContent=''; } }
  toggle.addEventListener('click',()=>setMode(!voiceMode)); setMode(false);
  record.addEventListener('click',async()=>{
    if(activeVoiceRecording) { if(activeVoiceRecording.mount===shell) stopVoiceRecording(); else status.textContent='请先完成另一条录音。'; return; }
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {status.textContent='当前浏览器不支持录音。'; return;}
    let stream;
    try {
      const uid=currentUser?.id; if(!uid) return;
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!voiceMode || !shell.isConnected || uid!==currentUser?.id) {stream.getTracks().forEach(t=>t.stop());return;}
      const supported=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=supported?new MediaRecorder(stream,{mimeType:supported}):new MediaRecorder(stream);
      const parts=[]; const current=++token;
      recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
      recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());if(activeVoiceRecording?.recorder===recorder){clearTimeout(activeVoiceRecording.timer);activeVoiceRecording=null;}
        if(current!==token || !shell.isConnected)return;
        blob=new Blob(parts,{type:recorder.mimeType||supported||'audio/mp4'});clearPreview();
        if(!blob.size){status.textContent='没有录到声音，请重试。'; record.textContent='点击录音';return;}
        previewUrl=URL.createObjectURL(blob); preview.src=previewUrl;preview.hidden=false;cancel.hidden=false;submit.hidden=false;record.textContent='重新录制';status.textContent='录音完成，可以先试听。';};
      blob=null;clearPreview();submit.hidden=true;cancel.hidden=false;recorder.start();activeVoiceRecording={recorder,stream,mount:shell,timer:setTimeout(stopVoiceRecording,60000)};record.textContent='停止';status.textContent='正在录音，最长 60 秒';
    } catch(e){stream?.getTracks().forEach(t=>t.stop());console.error(e);status.textContent='无法使用麦克风，请检查浏览器权限。';}
  });
  cancel.addEventListener('click',()=>{token++;stopVoiceRecording();blob=null;clearPreview();record.textContent='点击录音';cancel.hidden=true;submit.hidden=true;status.textContent='';});
  submit.addEventListener('click',async()=>{
    if(!blob||!currentUser)return;
    if (window.ChatComposer?.getFiles('diary').length) { status.textContent='请先用文字模式发送照片，再保存语音日记。'; return; }
    const uid=currentUser.id, savedBlob=blob; submit.disabled=true;record.disabled=true;status.textContent='正在保存…';
    let path=null, diaryId=null, committed=false;
    try {
      const ext=savedBlob.type.includes('webm')?'webm':'m4a';path=`${uid}/${crypto.randomUUID()}.${ext}`;
      const upload=await sb.storage.from(VOICE_BUCKET).upload(path,savedBlob,{contentType:savedBlob.type.split(';')[0],upsert:false});if(upload.error)throw upload.error;
      const diary=await sb.from('diaries').insert({author_id:uid,content:text.value.trim()||'语音日记',mood:selectedMood}).select('id').single();if(diary.error)throw diary.error;diaryId=diary.data.id;
      const note=await sb.from('diary_voice_notes').insert({diary_id:diaryId,owner_id:uid,audio_path:path});if(note.error)throw note.error;committed=true;
      blob=null;clearPreview();text.value='';selectedMood='';document.querySelectorAll('.mood-item').forEach(i=>{i.classList.remove('active');i.setAttribute('aria-pressed','false')});setMode(false);await loadAllDiaries();
    } catch(e){console.error(e);if(committed){alert('日记已保存，页面刷新失败，请稍后刷新。');return;}let cleanupFailed=false;if(diaryId){const result=await sb.from('diaries').delete().eq('id',diaryId).eq('author_id',uid);cleanupFailed=!!result.error;}if(path){const result=await sb.storage.from(VOICE_BUCKET).remove([path]);cleanupFailed=cleanupFailed||!!result.error;}status.textContent=cleanupFailed?'保存失败，清理未完全成功，请检查日记。':'保存失败，请稍后重试。';}
    finally{submit.disabled=false;record.disabled=false;}
  });
}
let diaryVoiceRenderVersion = 0;
async function renderDiaryVoiceNotes(){
  const version = ++diaryVoiceRenderVersion;
  if(!currentUser || !allDiaryList.length)return;
  const userId=currentUser.id;const ids=allDiaryList.map(item=>item.id);
  const {data,error}=await sb.from('diary_voice_notes').select('diary_id,audio_path').in('diary_id',ids);
  if(error){console.error('语音日记加载失败',error);return;}if(currentUser?.id!==userId || version !== diaryVoiceRenderVersion)return;
  for(const note of data||[]){
    const container=document.getElementById(`diary-${note.diary_id}`)?.querySelector('.diary-content');if(!container)continue;
    if(container.parentElement.querySelector('[data-diary-voice]'))continue;
    const button=document.createElement('button');button.type='button';button.className='diary-voice-play';button.dataset.diaryVoice='';button.textContent='▶ 语音日记';
    button.onclick=async()=>{button.disabled=true;try{const result=await sb.storage.from(VOICE_BUCKET).createSignedUrl(note.audio_path,600);if(result.error)throw result.error;const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.dataset.diaryVoice='';audio.src=result.data.signedUrl;button.replaceWith(audio);await audio.play().catch(()=>{});}catch(e){console.error(e);button.textContent='播放失败，重试';button.disabled=false;}};
    container.after(button);
  }
}
// Remove associated voice files before deleting a diary, avoiding orphaned private audio.
async function removeDiaryVoiceBeforeDelete(diaryId) {
  const {data,error} = await sb.from('diary_voice_notes').select('audio_path').eq('diary_id',diaryId).maybeSingle();
  if(error) throw error;
  if(!data)return;
  const removed = await sb.storage.from(VOICE_BUCKET).remove([data.audio_path]); if(removed.error)throw removed.error;
  const deleted = await sb.from('diary_voice_notes').delete().eq('diary_id',diaryId).eq('owner_id',currentUser.id); if(deleted.error)throw deleted.error;
}
