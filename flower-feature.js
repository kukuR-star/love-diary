/* 小红花流水：赠送和兑换分别展示；内容通过 DOM 文本节点呈现。 */
let flowerRecordsRequest = 0;
let redeemInFlight = false;

async function renderFlowerRecords() {
  if (!currentUser) return;
  const uid = currentUser.id;
  const ticket = ++flowerRecordsRequest;
  const sendList = document.getElementById('flower-list');
  const redeemList = document.getElementById('reward-history');
  if (!sendList || !redeemList) return;
  try {
    const {data, error} = await sb.from('flower_records')
      .select('id,sender_id,receiver_id,type,amount,reward_text,created_at')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order('created_at', {ascending:false});
    if (ticket !== flowerRecordsRequest || currentUser?.id !== uid) return;
    if (error) throw error;
    const records = data || [];
    function render(container, entries, emptyText, redemption) {
      container.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }
      for (const item of entries) {
        const row = document.createElement('div'); row.className = 'list-item';
        const left = document.createElement('div'); left.className = 'item-left';
        const title = document.createElement('div'); title.className = 'item-title';
        const desc = document.createElement('div'); desc.className = 'item-desc';
        const isMeSend = item.sender_id === uid;
        title.textContent = redemption
          ? `${item.reward_text && item.reward_text !== '兑换奖励' ? item.reward_text : '兑换奖励'} · ${item.amount} 朵`
          : `${isMeSend ? '送出' : '收到'} ${item.amount} 朵小红花`;
        const date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '';
        desc.textContent = redemption ? date : `${item.reward_text || '无备注'}${date ? ' · ' + date : ''}`;
        left.append(title, desc); row.append(left); container.append(row);
      }
    }
    render(sendList, records.filter(item => item.type === 'send'), '还没有送花记录', false);
    render(redeemList, records.filter(item => item.type === 'redeem'), '还没有兑换记录', true);
  } catch (error) {
    console.error('小红花记录加载失败', error);
    if (ticket !== flowerRecordsRequest) return;
    sendList.textContent = '记录加载失败，请稍后重试。';
    redeemList.textContent = '记录加载失败，请稍后重试。';
  }
}

async function redeemFlowerReward(id, displayedCost) {
  if (!currentUser || redeemInFlight) return;
  if (!confirm(`确定要用 ${displayedCost} 朵小红花兑换这个奖励吗？`)) return;
  redeemInFlight = true;
  try {
    const uid = currentUser.id;
    const [rewardResult, sentResult, redeemedResult] = await Promise.all([
      sb.from('reward_pool').select('id,content,flower_cost').eq('id',id).single(),
      sb.from('flower_records').select('amount').eq('receiver_id',uid).eq('type','send'),
      sb.from('flower_records').select('amount').eq('receiver_id',uid).eq('type','redeem')
    ]);
    const failure = [rewardResult, sentResult, redeemedResult].find(result => result.error);
    if (failure) throw failure.error;
    if (currentUser?.id !== uid) throw new Error('用户状态已改变');
    const reward = rewardResult.data;
    const cost = Number(reward.flower_cost);
    const sum = rows => (rows || []).reduce((total,row) => total + Number(row.amount || 0), 0);
    const balance = sum(sentResult.data) - sum(redeemedResult.data);
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error('奖励花费不正确');
    if (cost !== Number(displayedCost)) throw new Error('奖励花费已变化，请刷新后重试');
    if (balance < cost) throw new Error('小红花余额不足');
    const {error} = await sb.from('flower_records').insert({
      sender_id: uid, receiver_id: uid, type: 'redeem', amount: cost,
      reward_text: reward.content
    });
    if (error) throw error;
    alert('🎉 兑换成功！快去兑现奖励吧～');
    try {
      await loadFlowerStats();
      await Promise.all([loadRewardList(), renderFlowerRecords()]);
    } catch (refreshError) {
      console.error('兑换成功后刷新失败', refreshError);
      alert('兑换已成功，但页面刷新失败，请稍后重新打开页面。');
    }
  } catch (error) {
    console.error('兑换失败', error);
    alert('兑换失败：' + (error.message || '请稍后重试'));
  } finally { redeemInFlight = false; }
}
