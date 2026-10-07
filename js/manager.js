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

  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('mgrId');
    if (!el) return;
    const sel = document.createElement('select');
    sel.id = 'mgrId';
    sel.className = el.className + ' -ml-1 w-full cursor-pointer bg-transparent outline-none';
    sel.setAttribute('aria-label', '관리자 아이디 선택');
    sel.innerHTML = MANAGERS.map((m) => `<option value="${m.id}">${m.id} · ${m.agent}</option>`).join('');
    sel.value = get();
    sel.addEventListener('change', () => { set(sel.value); location.reload(); });
    el.replaceWith(sel);
  });
})();
