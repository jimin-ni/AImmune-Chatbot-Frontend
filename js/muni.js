/* =========================================================================
 * 뮤니(Muni) 캐릭터 애니메이션 컨트롤러
 * - 평소: idle gif 천천히 반복
 * - 승인/반려/확인 시: 해당 액션 gif로 전환 → 일정 시간 후 다시 idle
 *
 * 사용법:
 *   <img id="muni" ... /> 요소가 페이지에 있어야 함
 *   다른 스크립트에서 window.Muni.react('approve' | 'reject' | 'confirm') 호출
 * ========================================================================= */
(function () {
  const CFG = {
    base: 'img/',                 // gif 폴더
    idle:    'muni-idle.gif',     // 평소(느린 흔들림)
    approve: 'muni-approve.gif',  // 승인
    reject:  'muni-reject.gif',   // 반려
    confirm: 'muni-confirm.gif',  // 기술 문제 확인
    reactMs: 2800,                // 액션 애니메이션 보여주는 시간(ms) 후 idle 복귀
  };

  let timer = null;
  const el = () => document.getElementById('muni');

  // 같은 gif라도 처음부터 다시 재생되도록 캐시버스터(?t=) 사용
  function setSrc(file) {
    const m = el();
    if (!m) return;
    m.src = CFG.base + file + '?t=' + Date.now();
  }

  function idle() {
    clearTimeout(timer);
    setSrc(CFG.idle);
  }

  function react(type) {
    const m = el();
    if (!m) return;
    setSrc(CFG[type] || CFG.idle);
    clearTimeout(timer);
    timer = setTimeout(idle, CFG.reactMs);
  }

  window.Muni = { idle, react, CFG };

  // 로드되면 idle 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', idle);
  } else {
    idle();
  }
})();