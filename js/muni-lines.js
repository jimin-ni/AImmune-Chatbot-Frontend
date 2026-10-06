/* 뮤니 말풍선 문장 — 뮤니를 클릭하면 이 중 하나가 랜덤으로 나온다.
 * 문장을 바꾸거나 늘리려면 이 배열만 고치면 된다. (한 문장, 40자 안팎 권장)
 * 기획 근거: 말미잘 = 면역 프라이밍 / 신고 = 양분 / 공생·확장성 / 승인 기반 신뢰 */
export const MUNI_LINES = [
  '안녕, 나는 뮤니야! 말미잘에서 태어난 에이뮨의 에이전트야.',
  '말미잘은 비슷한 일을 겪을수록 더 빠르게 반응해. 그걸 면역 프라이밍이라고 해!',
  '너가 남기는 접수는 나의 양분이야. 쌓일수록 상담 에이전트가 더 똑똑해져.',
  '말미잘은 산호초에서 함께 살아가. 나도 JOY뿐 아니라 SAM, 흥부장과도 연결될 수 있어!',
  '나는 사내 에이전트를 고쳐 더 똑똑하고 강해지도록 만들어!',
  '에이전트는 담당자가 승인해야만 바뀌어. 나는 마음대로 고치지 않아!',
];

/* 같은 문장이 연달아 나오지 않도록, 한 바퀴를 섞어서 다 보여준 뒤 다시 섞는다. */
export function createLinePicker(lines = MUNI_LINES) {
  let bag = [];
  let last = null;
  return function next() {
    if (!bag.length) {
      bag = lines.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {          // Fisher–Yates
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop());  // 새 바퀴의 첫 문장이 직전과 같지 않게
    }
    last = bag.pop();
    return lines[last];
  };
}
