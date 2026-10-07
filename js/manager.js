/* 현재 담당자 선택 — 대시보드·처리 내역 화면 공통.
 * n8n은 신고를 에이전트별 담당자(JOY→M-001, SAM→M-002, 흥부장→M-003, AI아트랩→M-004)에게 배정하고,
 * 조회·승인·반려는 담당자 ID로 걸러진다. 그래서 화면에서 담당자를 고를 수 있어야 해당 에이전트 건이 보인다. */
(function () {
  const KEY = 'joy_manager';
  const MANAGERS = [
    { id: 'M-001', agent: 'JOY' },
    { id: 'M-002', agent: 'SAM' },
    { id: 'M-003', agent: '흥부장' },
    { id: 'M-004', agent: 'AI아트랩' },
  ];
  function get() {
    try {
      const v = localStorage.getItem(KEY);
      if (MANAGERS.some((m) => m.id === v)) return v;
    } catch (e) {}
    return MANAGERS[0].id;
  }
  function set(id) { try { localStorage.setItem(KEY, id); } catch (e) {} }

  window.AIMMUNE_MANAGER = { get, set, list: MANAGERS };

  /* '관리자 아이디' 회색 박스를 담당자 선택 드롭다운으로 바꾼다.
   * 기본 <select>는 모양을 바꿀 수 없어서, 라운드 박스 목록을 직접 만든다. */
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('mgrId');
    const row = el && el.parentElement && el.parentElement.parentElement; // 회색 박스
    if (!row) return;

    const label = (m) => `${m.id} · ${m.agent}`;
    const current = () => MANAGERS.find((m) => m.id === get()) || MANAGERS[0];

    el.textContent = label(current());
    row.classList.add('cursor-pointer', 'select-none');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-haspopup', 'listbox');
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-label', '관리자 아이디 선택');

    // 오른쪽 가운데 화살표 (크게, 가장자리에서 띄움)
    const chevron = document.createElement('span');
    chevron.className = 'mr-3 flex shrink-0 items-center justify-center text-ink/60 transition-transform duration-200';
    chevron.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    row.appendChild(chevron);

    // 선택 목록: 라운드 박스, 작은 글씨
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.className = 'absolute left-0 right-0 top-[calc(100%+8px)] z-50 hidden rounded-[16px] bg-white p-2 shadow-[0_4px_24px_rgba(0,0,0,0.12)]';
    list.innerHTML = MANAGERS.map((m) => `
      <li role="option" data-id="${m.id}" class="flex cursor-pointer items-center justify-between rounded-[12px] px-4 py-3 text-[22px] text-ink hover:bg-canvas">
        <span>${label(m)}</span><span class="mgr-check hidden text-[20px] text-salmon">✓</span>
      </li>`).join('');
    row.classList.add('relative');
    row.appendChild(list);

    const mark = () => list.querySelectorAll('li').forEach((li) => {
      const on = li.dataset.id === get();
      li.setAttribute('aria-selected', on ? 'true' : 'false');
      li.classList.toggle('bg-canvas', on);
      li.classList.toggle('font-semibold', on);
      li.querySelector('.mgr-check').classList.toggle('hidden', !on);
    });
    const open = (v) => {
      list.classList.toggle('hidden', !v);
      row.setAttribute('aria-expanded', v ? 'true' : 'false');
      chevron.style.transform = v ? 'rotate(180deg)' : '';
      if (v) mark();
    };

    row.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) {
        e.stopPropagation();
        if (li.dataset.id !== get()) { set(li.dataset.id); location.reload(); return; }
        open(false);
        return;
      }
      open(list.classList.contains('hidden'));
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(list.classList.contains('hidden')); }
      if (e.key === 'Escape') open(false);
    });
    document.addEventListener('click', (e) => { if (!row.contains(e.target)) open(false); });
  });
})();
