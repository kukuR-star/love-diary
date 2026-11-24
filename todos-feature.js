// Both partners may change completion state; only the creator may delete an item.
(() => {
  let requestId = 0, tasks = [], selectedDate = null, currentMonth = new Date(), initialized = false, sessionUser = null;
  const $ = id => document.getElementById(id);
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function node(tag, cls, content) { const el = document.createElement(tag); if(cls) el.className=cls; if(content !== undefined) el.textContent=content; return el; }
  function setupTodoDate() {
    const input = $('todo-date-input');
    if (!input) return;
    if (!input.closest('.todo-date-field')) {
      const wrapper = node('div', 'todo-date-field is-empty');
      const display = node('span', 'wish-date-label');
      const icon = node('span', 'wish-date-icon');
      display.setAttribute('aria-hidden', 'true'); icon.setAttribute('aria-hidden', 'true');
      input.before(wrapper); wrapper.append(display, icon, input);
      input.addEventListener('input', refreshTodoDate);
      input.addEventListener('change', refreshTodoDate);
    }
    refreshTodoDate();
  }
  function refreshTodoDate() {
    const input = $('todo-date-input'), wrapper = input?.closest('.todo-date-field');
    if (!wrapper) return;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(input.value);
    wrapper.querySelector('.wish-date-label').textContent = valid ? input.value.replaceAll('-', ' / ') : '年 / 月 / 日';
    wrapper.classList.toggle('is-empty', !valid);
  }
  function setStatus(message, error = false) { const el=$('todo-status'); if(el) { el.textContent=message; el.classList.toggle('is-error',error); } }
  function renderCalendar() {
    const grid=$('todo-calendar-grid'); if(!grid) return;
    const year=currentMonth.getFullYear(), month=currentMonth.getMonth();
    $('todo-month-label').textContent=`${year}年${month+1}月`;
    grid.replaceChildren();
    for(let i=0; i<new Date(year,month,1).getDay(); i++) grid.append(node('span','todo-calendar-blank'));
    const today=localDate(new Date()); const dates=new Set(tasks.filter(t=>t.due_date).map(t=>t.due_date));
    for(let i=1; i<=new Date(year,month+1,0).getDate(); i++) {
      const day=new Date(year,month,i), date=localDate(day), b=node('button','calendar-day todo-calendar-day',String(i));
      b.type='button'; b.setAttribute('aria-label',`${year}年${month+1}月${i}日`);
      b.setAttribute('aria-pressed',String(date === selectedDate));
      if(date === today) b.classList.add('today'); if(dates.has(date)) b.classList.add('has-diary'); if(date === selectedDate) b.classList.add('selected');
      b.addEventListener('click',()=>{selectedDate=selectedDate===date?null:date; renderCalendar();renderTasks();}); grid.append(b);
    }
  }
  function renderTasks() {
    const list=$('todo-items'); if(!list) return;
    const visible=selectedDate ? tasks.filter(t=>t.due_date===selectedDate) : tasks;
    $('todo-filter-label').textContent=selectedDate ? `${selectedDate.replaceAll('-', '/')} 的待办` : '全部待办';
    $('todo-clear-filter').hidden=!selectedDate;
    list.replaceChildren();
    if(!visible.length) {list.append(node('p','todo-empty',selectedDate?'这天还没有待办':'把生活里的小事记在这里。')); return;}
    for(const item of visible) {
      const row=node('article','todo-row'+(item.done?' is-done':''));
      const own=item.owner_id===currentUser?.id;
      const toggle=node('button','todo-check'); toggle.type='button'; toggle.setAttribute('aria-label',`${item.done?'标记未完成':'标记完成'}：${item.title}`); toggle.setAttribute('aria-pressed',String(item.done));
      toggle.addEventListener('click',()=>updateTodo(item));
      const body=node('div','todo-body');
      const title=node('input','todo-title'); title.type='text'; title.value=item.title; title.maxLength=100; title.setAttribute('aria-label','编辑待办内容');
      let canceled=false, saving=false;
      title.addEventListener('keydown',event=>{
        if(event.isComposing) return;
        if(event.key==='Enter'){event.preventDefault();title.blur();}
        if(event.key==='Escape'){canceled=true;title.value=item.title;title.blur();}
      });
      title.addEventListener('blur',async()=>{
        if(canceled){canceled=false;return;}
        const value=title.value.trim();
        if(!value){title.value=item.title;setStatus('待办内容不能为空。',true);return;}
        if(value===item.title || saving){title.value=value;return;}
        saving=true;title.disabled=true;
        try {
          const {data,error}=await sb.from('couple_todos').update({title:value}).eq('id',item.id).eq('title',item.title).select('id');
          if(error)throw error;
          if(!data?.length){await loadTodos();setStatus('待办已被修改，请确认最新内容。',true);return;}
          item.title=value;title.value=value;toggle.setAttribute('aria-label',`${item.done?'标记未完成':'标记完成'}：${value}`);setStatus('');
        } catch(e){console.error('待办保存失败',e);title.value=item.title;setStatus('保存失败，请检查网络后重试。',true);}
        finally{saving=false;title.disabled=false;}
      });
      body.append(title);
      const owner=own?'我':(partnerProfile?.nickname || 'TA'); body.append(node('div','todo-meta',`${owner}${item.due_date ? ' · '+item.due_date.replaceAll('-','/') : ''}`));
      row.append(toggle,body);
      if(own){ const remove=node('button','todo-remove','删除'); remove.type='button'; remove.setAttribute('aria-label',`删除 ${item.title}`); remove.addEventListener('click',()=>removeTodo(item.id)); row.append(remove); }
      list.append(row);
    }
  }
  async function loadTodos() {
    if(!currentUser || !$('todos-root')) return;
    const uid=currentUser.id, req=++requestId;
    setStatus('加载中…');
    try {
      const {data,error}=await sb.from('couple_todos').select('id,owner_id,title,due_date,done,created_at').order('created_at',{ascending:false});
      if(error) throw error;
      if(req!==requestId || currentUser?.id!==uid) return;
      tasks=(data||[]).sort((a,b)=> Number(a.done)-Number(b.done));
      renderCalendar();renderTasks();setStatus('');
    } catch(e) {console.error('待办加载失败',e);if(req===requestId)setStatus('暂时无法加载待办，请稍后重试。',true);}
  }
  async function updateTodo(item) {
    if(!currentUser) return;
    const {data,error}=await sb.from('couple_todos').update({done:!item.done}).eq('id',item.id).eq('done',item.done).select('id');
    if(error) return setStatus('操作失败，请稍后重试。',true);
    if(!data?.length) { await loadTodos(); return setStatus('待办已更新，请确认当前状态。',true); }
    await loadTodos();
  }
  async function removeTodo(id) {
    if(!currentUser || !confirm('确定删除这条待办吗？')) return;
    const {data,error}=await sb.from('couple_todos').delete().eq('id',id).eq('owner_id',currentUser.id).select('id');
    if(error || !data?.length) return setStatus('删除失败，请稍后重试。',true);
    await loadTodos();
  }
  window.initTodos = async function() {
    const root=$('todos-root'); if(!root || !currentUser) return;
    if (sessionUser !== currentUser.id) { sessionUser = currentUser.id; tasks = []; selectedDate = null; currentMonth = new Date(); }
    if(!initialized || !$('todo-form')) {
      root.innerHTML=`<section class="todo-shell"><header class="todo-heading"><div><p class="todo-kicker">LITTLE THINGS</p><h2>一起打理生活</h2><p>把琐碎的事，轻轻放在这里。</p></div></header><form id="todo-form" class="todo-form"><label class="todo-visually-hidden" for="todo-title-input">待办内容</label><input id="todo-title-input" maxlength="100" placeholder="添加一件待办…" required><label class="todo-visually-hidden" for="todo-date-input">日期（可选）</label><input id="todo-date-input" type="date" aria-label="日期（可选）"><button type="submit">添加</button></form><details class="todo-calendar"><summary>日历 <span>按日期查看</span></summary><div class="calendar-header todo-calendar-nav"><button type="button" id="todo-prev" aria-label="上个月">‹</button><strong id="todo-month-label"></strong><button type="button" id="todo-next" aria-label="下个月">›</button></div><div class="week-header todo-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="calendar-grid todo-calendar-grid" id="todo-calendar-grid"></div></details><div class="todo-list-heading"><h3 id="todo-filter-label">全部待办</h3><button type="button" id="todo-clear-filter" hidden>查看全部</button></div><div id="todo-items"></div><p id="todo-status" class="todo-status" role="status" aria-live="polite"></p></section>`;
      setupTodoDate();
      $('todo-prev').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();};
      $('todo-next').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();};
      $('todo-clear-filter').onclick=()=>{selectedDate=null;renderCalendar();renderTasks();};
      $('todo-form').onsubmit=async e=>{
        e.preventDefault(); if(!currentUser)return;
        const uid=currentUser.id, input=$('todo-title-input'), date=$('todo-date-input'), title=input.value.trim();
        if(!title || title.length>100)return setStatus('请输入待办内容。',true);
        const button=e.currentTarget.querySelector('button'); button.disabled=true;setStatus('保存中…');
        try {const {error}=await sb.from('couple_todos').insert({owner_id:uid,title,due_date:date.value||null});if(error)throw error;if(currentUser?.id!==uid)return;input.value='';date.value='';refreshTodoDate();selectedDate=null;await loadTodos();}
        catch(error){console.error(error);setStatus('保存失败，请稍后重试。',true);}
        finally {button.disabled=false;}
      };
      initialized=true;
    }
    await loadTodos();
  };
})();
