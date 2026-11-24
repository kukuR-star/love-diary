// A visible date label gives iOS the same empty state as desktop while the
// native date input remains responsible for choosing and validating dates.
(function () {
  const input = document.getElementById('wish-deadline');
  if (!input || input.closest('.wish-date-field')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'wish-date-field';
  const display = document.createElement('span');
  display.className = 'wish-date-label';
  display.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'wish-date-icon';
  icon.setAttribute('aria-hidden', 'true');
  input.before(wrapper);
  wrapper.append(display, icon, input);
  input.setAttribute('aria-label', '愿望日期，可选');
  function refresh() {
    const value = input.value;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
    display.textContent = valid ? value.replaceAll('-', ' / ') : '年 / 月 / 日';
    wrapper.classList.toggle('is-empty', !valid);
  }
  input.addEventListener('input', refresh);
  input.addEventListener('change', refresh);
  window.refreshWishDate = refresh;
  refresh();
})();
