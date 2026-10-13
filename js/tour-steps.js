/* =========================================================================
 * 관리자 대시보드 가이드 — 단계 정의
 * 문구·순서·표정만 바꾸려면 이 파일만 고치면 된다.
 *
 *  target : 하이라이트할 요소 선택자 (없으면 화면 가운데에 말풍선만)
 *  before : 'close' = 상세 닫기 / 'REVISION' | 'MANUAL' | 'TECH' = 해당 종류의 첫 카드 열기
 *  when   : 해당 종류의 항목이 있을 때만 보여 줌
 *  muni   : 뮤니 표정 idle | approve | reject | confirm
 * ========================================================================= */
window.AIMMUNE_TOUR_STEPS = [
  { id: 'welcome', target: null, before: 'close', muni: 'idle',
    title: '안녕, 나는 뮤니야!',
    text: '관리자 대시보드를 같이 둘러볼까? 1분이면 충분해.' },
  { id: 'manager', target: '[data-tour="manager"]', before: 'close', muni: 'idle',
    title: '담당자 선택',
    text: '담당자를 고르면 그 담당자가 맡은 에이전트의 건만 보여!' },
  { id: 'list', target: '#listCol', muni: 'idle',
    title: '진행 대기 목록',
    text: '지침 개정 대기, 수동검토, 기술 문제로 나뉘고 위험도가 높은 건이 먼저 와.' },
  { id: 'card', target: '#listWrap .card-item', muni: 'idle',
    title: '카드를 눌러 상세 보기',
    text: '카드를 누르면 오른쪽에 자세한 내용이 열려.' },
  { id: 'compare', target: '[data-tour="compare"]', before: 'REVISION', when: 'REVISION', muni: 'idle',
    title: '수정 전 → 수정 제안',
    text: 'AI가 신고를 보고 만든 수정 전·후 문장이야. 어디가 바뀌는지 비교해 봐.' },
  { id: 'decide', target: '#actionBar', before: 'REVISION', when: 'REVISION', muni: 'approve',
    title: '승인 또는 반려',
    text: '승인하면 새 지침이 반영되고, 반려하면 사유가 남아. 결정은 언제나 담당자 몫이야!' },
  { id: 'manual', target: '[data-tour="manual-modes"]', before: 'MANUAL', when: 'MANUAL', muni: 'reject',
    title: '수동검토',
    text: 'AI가 판단하지 못했거나 반려된 건은 직접 수정안을 쓰거나, 변경 없이 끝낼 수 있어.' },
  { id: 'tech', target: '[data-tour="tech-confirm"]', before: 'TECH', when: 'TECH', muni: 'confirm',
    title: '기술 문제 확인',
    text: '응답 지연이나 시스템 오류는 지침과 별개야. 조치를 마친 뒤 확인을 눌러 줘.' },
  { id: 'history', target: '#btnHistory', before: 'close', muni: 'approve',
    title: '민원 처리 내역',
    text: '승인하거나 반려한 건은 여기서 다시 볼 수 있어.' },
  { id: 'again', target: '#btnTour', muni: 'idle',
    title: '언제든 다시',
    text: '가이드는 이 뮤니 버튼으로 다시 볼 수 있어. 그럼 잘 부탁해!' },
];
