document.addEventListener('DOMContentLoaded', () => {
  const pendingCards = document.querySelectorAll('.item-card');
  const detailPanel = document.getElementById('detail-panel');
  
  const btnApprove = document.getElementById('btn-approve');
  const btnReject = document.getElementById('btn-reject');
  const rejectReasonBox = document.getElementById('reject-reason-box');
  const actionButtonGroup = document.getElementById('action-button-group');
  const btnRejectCancel = document.getElementById('btn-reject-cancel');
  const btnRejectSubmit = document.getElementById('btn-reject-submit');
  const rejectReasonInput = document.getElementById('reject-reason-input');

  // 1. 대기 목록 항목 클릭 시 우측 상세 영역 등장 처리
  pendingCards.forEach(card => {
    card.addEventListener('click', () => {
      // 모든 카드의 강조 스타일 초기화
      pendingCards.forEach(c => {
        c.classList.remove('border-2', 'border-red-400', 'bg-red-50/20');
        c.classList.add('border', 'border-gray-200', 'bg-white');
      });

      // 선택한 카드 강조 스타일 적용
      card.classList.remove('border', 'border-gray-200', 'bg-white');
      card.classList.add('border-2', 'border-red-400', 'bg-red-50/20');

      // 우측 상세 화면 노출
      if (detailPanel) {
        detailPanel.classList.remove('hidden');
        detailPanel.classList.add('flex');
      }
    });
  });

  // 2. 승인 버튼
  if (btnApprove) {
    btnApprove.addEventListener('click', () => {
      if (confirm('해당 지침서 개정안을 승인하시겠습니까?')) {
        alert('승인이 완료되었습니다.');
      }
    });
  }

  // 3. 반려 버튼 -> 사유 입력 창 토글
  if (btnReject) {
    btnReject.addEventListener('click', () => {
      rejectReasonBox.classList.remove('hidden');
      rejectReasonBox.classList.add('flex');
      actionButtonGroup.classList.add('hidden');
    });
  }

  // 4. 반려 취소
  if (btnRejectCancel) {
    btnRejectCancel.addEventListener('click', () => {
      rejectReasonBox.classList.add('hidden');
      rejectReasonBox.classList.remove('flex');
      actionButtonGroup.classList.remove('hidden');
      rejectReasonInput.value = '';
    });
  }

  // 5. 반려 확정
  if (btnRejectSubmit) {
    btnRejectSubmit.addEventListener('click', () => {
      const reason = rejectReasonInput.value.trim();
      if (!reason) {
        alert('반려 사유를 입력해 주세요.');
        return;
      }
      alert(`반려 처리되었습니다.\n사유: ${reason}`);
      rejectReasonBox.classList.add('hidden');
      rejectReasonBox.classList.remove('flex');
      actionButtonGroup.classList.remove('hidden');
      rejectReasonInput.value = '';
    });
  }
});