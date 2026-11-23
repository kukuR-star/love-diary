/* Shared milestones. Access control is enforced by the couple_events RLS policies. */
(() => {
  const rootId = 'milestones-root';
  let requestVersion = 0;
  let midnightTimer;

  const dateOrdinal = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  function todayOrdinal() {
    const today = new Date();
    return dateOrdinal(today.getFullYear(), today.getMonth() + 1, today.getDate());
  }
  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return dateOrdinal(year, month, day);
  }
  function dayText(event) {
    const ordinal = parseDate(event.event_date);
    if (ordinal === null) return {number: '—', label: '日期无效'};
    const delta = ordinal - todayOrdinal();
    if (event.kind === 'since') {
      if (delta > 0) return {number: String(delta), label: '天后开始'};
      return {number: String(-delta), label: '天 · 从这天算起'};
    }
    if (delta > 0) return {number: String(delta), label: '天 · 倒数'};
    if (delta === 0) return {number: '0', label: '就是今天'};
    return {number: String(-delta), label: '天 · 已过去'};
  }
  function make(tag, cls, value) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function setStatus(message, isError = false) {
    const status = document.getElementById('milestone-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }
  function renderEvents(events) {
    const list = document.getElementById('milestone-list');
    if (!list) return;
    list.replaceChildren();
    if (!events.length) {
      list.append(make('p', 'milestone-empty', '为值得期待或珍藏的日子，留一个位置。'));
      return;
    }
    for (const event of events) {
      const card = make('article', 'milestone-item');
      const top = make('div', 'milestone-item-top');
      top.append(make('span', 'milestone-kind', event.kind === 'since' ? '一直以来' : '值得期待'));
      if (currentUser && event.owner_id === currentUser.id) {
        const remove = make('button', 'milestone-remove', '删除');
        remove.type = 'button';
        remove.setAttribute('aria-label', `删除 ${event.title}`);
        remove.addEventListener('click', () => removeMilestone(event.id, event.title));
        top.append(remove);
      }
      const title = make('h4', 'milestone-name', event.title);
      const count = make('div', 'milestone-count');
      const value = dayText(event);
      count.append(make('strong', '', value.number), make('span', '', value.label));
      const date = make('p', 'milestone-date', event.event_date.replaceAll('-', ' / '));
      card.append(top, title, count, date);
      list.append(card);
    }
  }
  async function loadMilestones() {
    const user = currentUser;
    if (!user) return;
    const version = ++requestVersion;
    setStatus('正在加载日子…');
    try {
      const {data, error} = await sb.from('couple_events').select('id,owner_id,title,event_date,kind,created_at').order('created_at', {ascending: false});
      if (version !== requestVersion || currentUser?.id !== user.id) return;
      if (error) throw error;
      renderEvents(data || []);
      setStatus('');
    } catch (error) {
      console.error('加载纪念日失败', error);
      setStatus('暂时无法加载日子，请检查网络后重试。', true);
    }
  }
  async function removeMilestone(id, title) {
    if (!currentUser || !window.confirm(`确定删除“${title}”吗？`)) return;
    setStatus('正在删除…');
    try {
      const {data, error} = await sb.from('couple_events').delete().eq('id', id).eq('owner_id', currentUser.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('没有删除权限或记录不存在');
      await loadMilestones();
    } catch (error) {
      console.error('删除纪念日失败', error);
      setStatus('删除失败，请检查网络后重试。', true);
    }
  }
  function scheduleRefresh() {
    clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(() => { loadMilestones(); scheduleRefresh(); }, Math.max(1000, next - now + 1000));
  }
  window.initMilestones = async function initMilestones() {
    const root = document.getElementById(rootId);
    if (!root || !currentUser) return;
    root.innerHTML = `
      <section class="milestones-section" aria-labelledby="milestones-heading">
        <div class="milestones-header"><div><p class="milestones-eyebrow">THE DAYS WE KEEP</p><h2 id="milestones-heading">我们的日子</h2><p class="milestones-intro">记住已经走过的，也期待即将到来的。</p></div></div>
        <div id="milestone-list" class="milestone-list"></div>
        <details class="milestone-editor"><summary>＋ 记录一个日子</summary>
          <form id="milestone-form" class="milestone-form">
            <label>名称<input name="title" maxlength="60" placeholder="例如：我们在一起" required></label>
            <label>日期<input name="event_date" type="date" required></label>
            <label>记录方式<select name="kind"><option value="since">从这天开始正计时</option><option value="countdown">向这天倒计时</option></select></label>
            <button type="submit">保存日子</button>
          </form>
        </details>
        <p id="milestone-status" class="milestone-status" role="status" aria-live="polite"></p>
      </section>`;
    root.querySelector('#milestone-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!currentUser) return setStatus('请先登录。', true);
      const form = event.currentTarget;
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const date = String(data.get('event_date') || '');
      const kind = String(data.get('kind') || '');
      if (!title || title.length > 60 || parseDate(date) === null || !['since', 'countdown'].includes(kind)) return setStatus('请填写名称和有效日期。', true);
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      setStatus('正在保存…');
      try {
        const {error} = await sb.from('couple_events').insert({owner_id: currentUser.id, title, event_date: date, kind});
        if (error) throw error;
        form.reset();
        form.closest('details').open = false;
        await loadMilestones();
      } catch (error) {
        console.error('保存纪念日失败', error);
        setStatus('保存失败，请检查网络或稍后重试。', true);
      } finally { button.disabled = false; }
    });
    scheduleRefresh();
    await loadMilestones();
  };
})();
