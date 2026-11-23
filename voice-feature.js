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
  const heading = document.createElement('div'); heading.className = 'voice-heading'; heading.textContent = '语音留言';
  const list = document.createElement('div'); list.className = 'voice-list';
  const status = document.createElement('p'); status.className = 'voice-status'; status.setAttribute('role', 'status');
  const recorderButton = document.createElement('button'); recorderButton.type = 'button'; recorderButton.className = 'voice-button'; recorderButton.textContent = '录一段语音';
  const transcript = document.createElement('textarea'); transcript.className = 'voice-transcript'; transcript.placeholder = '可填写或编辑语音文字'; transcript.maxLength = 2000; transcript.hidden = true;
  const dictated = document.createElement('button'); dictated.type = 'button'; dictated.className = 'voice-dictate'; dictated.textContent = '实时听写'; dictated.hidden = true;
  const send = document.createElement('button'); send.type = 'button'; send.className = 'voice-send'; send.textContent = '发送语音'; send.hidden = true;
  const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'voice-discard'; discard.textContent = '取消'; discard.hidden = true;
  const note = document.createElement('p'); note.className = 'voice-note'; note.textContent = '最长 60 秒。实时听写依赖浏览器，可能使用第三方识别服务；也可以手动填写文字。';
  const actions = document.createElement('div'); actions.className = 'voice-actions'; actions.append(recorderButton, dictated, send, discard);
  section.append(heading,list,actions,transcript,note,status); mount.append(section);
  let blob = null; let recordingId = 0;
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
        if (!blob.size) { status.textContent='没有录到声音，请重试。'; recorderButton.textContent='录一段语音'; return; }
        recorderButton.textContent='重新录制'; transcript.hidden = false; send.hidden=false; discard.hidden=false; dictated.hidden=true; status.textContent='录制完成，可编辑文字后发送。';
      };
      recorder.start();
      activeVoiceRecording = {recorder, stream, mount, timer:setTimeout(stopVoiceRecording,60000)};
      blob=null; transcript.value=''; transcript.hidden=false; send.hidden=true; discard.hidden=true;
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
  discard.addEventListener('click', () => { recordingId++; stopVoiceRecording(); blob=null; transcript.value=''; transcript.hidden=true; send.hidden=true; discard.hidden=true; dictated.hidden=true; recorderButton.textContent='录一段语音'; status.textContent=''; });
  send.addEventListener('click', async () => {
    if(!blob || currentUser?.id !== uid) return; send.disabled=true; recorderButton.disabled=true; status.textContent='正在发送…';
    const extension = blob.type.includes('webm') ? 'webm' : 'm4a'; const path = `${uid}/${crypto.randomUUID()}.${extension}`;
    let uploaded=false;
    try {
      const upload=await sb.storage.from(VOICE_BUCKET).upload(path,blob,{contentType:blob.type.split(';')[0],upsert:false}); if(upload.error) throw upload.error; uploaded=true;
      const result=await sb.from('voice_comments').insert({diary_id:diaryId,owner_id:uid,audio_path:path,transcript:transcript.value.trim() || null}); if(result.error) throw result.error;
      blob=null; transcript.value=''; transcript.hidden=true; send.hidden=true; discard.hidden=true; recorderButton.textContent='录一段语音'; status.textContent=''; await load();
      if (typeof refreshCommentCounts === 'function') await refreshCommentCounts();
    } catch(e) { if(uploaded) await sb.storage.from(VOICE_BUCKET).remove([path]); console.error(e); status.textContent='发送失败，请检查网络后重试。'; }
    finally { send.disabled=false; recorderButton.disabled=false; }
  });
  await load();
}
