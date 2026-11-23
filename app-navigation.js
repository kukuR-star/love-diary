// A persistent bottom navigation keeps the selected section one tap away.
(() => {
  const icons = {
    diary: '<path d="M5 4.5h14v15H5zM8 8h8M8 11.5h8M8 15h5"/>',
    flower: '<path d="M12 12c-1-2-4-2-4-4a2 2 0 0 1 4-1 2 2 0 0 1 4 1c0 2-3 2-4 4Zm0 0c-1 2-4 2-4 4a2 2 0 0 0 4 1 2 2 0 0 0 4-1c0-2-3-2-4-4ZM6 12h12"/>',
    todos: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m7 9 1 1 2-2m2 1h5m-10 5 1 1 2-2m2 1h5"/>',
    wish: '<path d="M4 10h16v9H4zM3 7h18v3H3zM12 7v12M12 7c-1.8 0-4-.8-4-2.4C8 2.7 11 3.1 12 7ZM12 7c1.8 0 4-.8 4-2.4C16 2.7 13 3.1 12 7Z"/>',
    album: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="9.5" r="1.2"/><path d="m5 17 4.5-4.5 3 3 2.5-2.5 4 4"/>'
  };
  const labels = {diary:'日记', flower:'小红花', todos:'待办', wish:'愿望', album:'相册'};
  const tabs = [...document.querySelectorAll('.main-tab')];
  const navigation = document.querySelector('.main-tabs');
  const milestones = document.getElementById('milestones-root');
  if (!navigation) return;
  navigation.setAttribute('role', 'navigation');
  navigation.setAttribute('aria-label', '功能导航');
  tabs.forEach(tab => {
    const name = tab.dataset.tab;
    if (!icons[name]) return;
    tab.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg><span>${labels[name]}</span>`;
    tab.setAttribute('aria-label', labels[name]);
    tab.setAttribute('aria-current', tab.classList.contains('active') ? 'page' : 'false');
    tab.addEventListener('click', () => {
      tabs.forEach(item => item.setAttribute('aria-current', item === tab ? 'page' : 'false'));
      if (milestones) milestones.hidden = name !== 'diary';
      window.scrollTo({top: 0, behavior: 'auto'});
    });
  });
})();
