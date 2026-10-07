# DESIGN — 챗봇 화면 (index.html)

> 대상: `index.html` · `js/main.js` · `css/dark.css` · `css/korean.css`
> 이 문서의 값은 현재 코드에서 추출했다. 값을 바꾸면 이 문서도 함께 고친다.

## 1. 개요·원칙

| 항목 | 내용 |
|---|---|
| 목적 | 영업 담당자가 에이전트 **I'M JOY**와 대화하는 첫 화면 |
| 사용자 | KT m&s 영업 담당자 (PC 브라우저 중심) |
| 스택 | Tailwind CDN + 바닐라 JS. 나이트 모드만 `css/dark.css`로 덮어쓴다 |

**원칙**
1. **조용한 화면** — 흰 면과 얇은 선 위주. 색은 파랑 한 가지(`#5489ea`)만 강조에 쓴다.
2. **대화가 주인공** — 헤더·입력바는 얇게, 대화 영역이 가장 크다.
3. **한글이 먼저** — 단어 중간에서 줄이 끊기지 않게 한다 (`word-break: keep-all`).
4. **나이트 모드는 이 화면만** — 다른 화면(폼·대시보드)에는 적용하지 않는다.

## 2. 색상 토큰

### 라이트 모드
| 토큰(제안 이름) | HEX / Tailwind | 용도 |
|---|---|---|
| `bg-page` | `#f8f9fa` | 페이지 배경, 하단 바 배경 |
| `bg-surface` | `#ffffff` (`bg-white`) | 헤더, 답변 카드, 입력바 |
| `bg-welcome` | `#eceef3` | 홈 인사 카드 |
| `accent` | `#5489ea` | 초기화·전송·다크모드 버튼 |
| `accent-hover` | `bg-blue-600` | 위 버튼 호버 |
| `report-btn` | `#3b82f6` | 건의 접수(뮤니) 버튼 배경 |
| `border-header` | `#E1E1E1` | 서브 바 위·아래 선 |
| `border-card` | `gray-200` / `gray-300` | 카드 / 입력바 테두리 |
| `text-body` | `gray-800` | 본문 |
| `text-sub` | `gray-700` · `gray-600` · `gray-500` | 제목 / 보조 / 설명 |
| `text-link` | `blue-600` | 강조 단어 (예: I'M JOY) |
| `bubble-user` | 그라데이션 `cyan-400 → blue-500 → indigo-600` + 흰 글자 | 내 말풍선 |

### 나이트 모드 (`html.dark`)
| 대상 | 라이트 | 나이트 |
|---|---|---|
| 페이지 배경 | `#f8f9fa` | `#0f1218` |
| 면 (`bg-white`) | `#ffffff` | `#1a1e27` |
| 홈 카드 | `#eceef3` | `#202531` |
| 선 | `#E1E1E1` / gray-200~300 | `#2d3240` |
| 본문 글자 | gray-800 | `#eef0f7` |
| 보조 글자 | gray-700 / 600 / 500 | `#cdd3e3` / `#b6bdd0` / `#9aa3b8` |
| 파랑 글자 | blue-500 / 600 | `#7aa6ff` |
| placeholder | gray-400 | `#7c869d` |
| 스크롤바 | `#cbd5e1` | `#3a4050` |

## 3. 타이포그래피

| 용도 | 크기·굵기 |
|---|---|
| 폰트 | Tailwind 기본 `font-sans` (시스템 폰트) |
| 홈 인사 제목 | `text-base` (16px) bold |
| 홈 설명 | `text-sm` (14px), `leading-relaxed` |
| 서브 바 "I'M JOY" | `text-sm` semibold |
| 내 말풍선 | `text-base` medium / 시각 `text-xs` |
| JOY 답변 제목 | `text-lg` bold |
| JOY 답변 본문 | `text-sm`, `leading-relaxed` (마크다운 렌더) |
| 입력창 | `text-base` |

**한글 줄바꿈 (`css/korean.css`, 전 화면 공통)**
- `word-break: keep-all` — 단어 중간에서 끊지 않음
- `overflow-wrap: break-word` — 아주 긴 문자열(URL 등)은 넘치지 않게
- `h1~h4 { text-wrap: balance }`, `p, li { text-wrap: pretty }`

## 4. 레이아웃·간격

| 영역 | 규칙 |
|---|---|
| 전체 | `min-h-screen`, 세로 flex (헤더 / 본문 / 하단 바) |
| 헤더 1단 | 최대 폭 1600px, 좌우 `px-8`, 상하 `py-3`. **좌 kt m&s · 중앙 NEXUS · 우 사용자 버튼** |
| 헤더 2단 | 뒤로가기 + "I'M JOY", 위·아래 1px `#E1E1E1` 선 |
| 본문 | 최대 폭 1200px, `p-4`, 홈/채팅 두 상태 중 하나만 표시 |
| 홈 카드 | 최대 폭 720px, `rounded-3xl`, `p-10`, 가운데 정렬 |
| 채팅 영역 | `max-h-[65vh]`, 세로 스크롤, 항목 간격 `space-y-6` |
| 하단 바 | 최대 폭 1200px, `px-6 py-4`, 좌(초기화) · 중(입력) · 우(도구) |

## 5. 컴포넌트

| 컴포넌트 | 규격 | 상태 |
|---|---|---|
| **kt m&s 로고** | 높이 `h-6`(24px) | 클릭 → https://www.ktmns.com/ (새 탭). 나이트: `invert(1) hue-rotate(180deg)`로 글자만 흰색 |
| **NEXUS 로고** | 높이 `h-[50px]` | 클릭 → 처음 화면. 낮 `nexus3.png` / 밤 `nexus4.png` (두 장을 두고 CSS로 전환) |
| **원형 버튼** (초기화·건의·다크모드) | 48×48px, `rounded-full`, 그림자 `shadow` | 호버: 한 단계 진한 파랑 |
| **전송 버튼** | 32×32px 원형, `#5489ea` | 호버: `bg-blue-600` |
| **입력바** | 흰 면, `border-gray-300`, `rounded-full`, `px-5 py-2.5` | placeholder "Agent JOY에게 질문하세요" |
| **내 말풍선** | 최대 폭 70%, `p-5`, 모서리 `24 24 0 24` | 오른쪽 정렬 |
| **JOY 답변 카드** | 최대 폭 850px, `rounded-3xl`, `p-8`, 테두리 gray-200, 앞에 파란 점(12px) | 왼쪽 정렬 |
| **헤더 아이콘** (프로필·로그아웃·도움말) | 높이 28px / 28px / 36px | 호버 `opacity-80` |

**다크모드 버튼 (`#btn-theme`)**: 라이트=달 아이콘, 다크=해 아이콘. 선택은 `localStorage('joy_theme')`에 저장하고, 첫 화면을 그리기 전에 적용해 깜빡임을 막는다.

## 6. 인터랙션·모션

| 동작 | 설명 |
|---|---|
| 초기화 버튼 | `/` 를 전송한 것과 같다 → 성공 시 화면의 이전 대화를 지우고 홈 인사 화면으로 복귀, 세션 ID 제거 |
| 뒤로가기 | 홈 화면으로 복귀 + 세션 초기화 |
| 건의 접수 버튼 | `report_form_v3.html` 로 이동 |
| 도움말 버튼 | `dashboard.html` 로 이동 |
| 나이트 모드 전환 | 0.25초 동안 배경·글자·선 색만 부드럽게 전환 (`theme-anim`) |

## 7. 접근성

- 로고 링크에 `aria-label` (예: "kt m&s 홈페이지", "NEXUS — 처음 화면으로")
- 다크모드 버튼: `aria-label`, `aria-pressed`
- 대비: 나이트 모드 본문 `#eef0f7` on `#0f1218`로 충분한 대비 확보
- 이미지 대체 텍스트(alt) 사용

## 8. Do / Don't

| Do | Don't |
|---|---|
| 강조색은 `#5489ea` 한 가지로 통일 | 버튼마다 다른 파랑 사용 (현재 건의 버튼만 `#3b82f6` — 정리 후보) |
| 한글 문단은 `keep-all` 유지 | 글자 수에 맞춰 임의로 `<br>` 삽입 |
| 나이트 모드 색은 `css/dark.css`에만 추가 | 다른 화면에 `dark.css` 연결 |
| 나이트 NEXUS는 `nexus4.png` 그대로 | 나이트 NEXUS에 둥근 모서리·배경·패딩 적용 |
| 로고 크기는 낮/밤 동일 | 낮/밤에 서로 다른 높이 지정 |

## 9. 코드 위치

| 내용 | 파일 |
|---|---|
| 마크업·Tailwind 클래스 | `index.html` |
| 대화·초기화·테마 동작 | `js/main.js` |
| 나이트 모드 | `css/dark.css` |
| 한글 줄바꿈 | `css/korean.css` |
| 탭 아이콘 | `img/favicon/nexus.png` |

## 알려진 정리 후보
- 건의 버튼 파랑(`#3b82f6`)과 나머지 파랑(`#5489ea`) 불일치
- 색상이 Tailwind 임의값(`bg-[#5489ea]`)으로 흩어져 있어, 토큰(CSS 변수)으로 모으면 나이트 모드 관리가 쉬워짐
