# rHWP + NextCloud 동시편집 — 렌더링 고도화

전북특별자치도청 생성형 AI 시스템 고도화 캡스톤 과제.
NextCloud에서 HWP/HWPX 파일을 여러 사용자가 동시에 편집할 수 있는 시스템의 **렌더링 완성도 향상**.

## 프로젝트 개요

rHWP CRDT 동시편집 시스템(v3.0.2)을 기반으로,
**큰 HWP/HWPX 파일에서 발생하는 글꼴·레이아웃·이미지 렌더링 버그를 수정**하여
실무 사용 가능한 수준으로 완성도를 높이는 것이 목표.

### 기존 시스템

- Lamport Clock 기반 CRDT 동시편집
- Python WebSocket 서버 + NextCloud rhwp_connector 앱
- OnlyOffice 스타일 원격 커서 (7컬러)
- 50ms 배치 전송, 재연결 동기화
- 프로덕션 배포: https://ai.jb.go.kr/rhwp/

### 우리의 역할

- rHWP 렌더링 엔진(Rust/WASM) 버그 분석 및 수정
- 큰 파일(300+ 페이지) 렌더링 정확도 향상
- 수정 사항을 edwardkim/rhwp 본가에 컨트리뷰션

## 레포 구조

```
rhwp-collab/
├── rhwp/                          ← rHWP 소스 (submodule, Rust)
│                                     렌더링 버그 수정 대상
├── 01-rhwp-studio/                ← 협업 브릿지 코드 (TS)
│   ├── iframe-collab-bridge.ts       동시편집 postMessage 통신
│   ├── collaboration.ts              세션 관리
│   └── yjs-bridge.ts                 Yjs 대안 구현
├── 02-rhwp-collab-server/         ← Python WebSocket CRDT 서버
├── 03-rhwp-yjs-server/            ← Yjs 대안 서버 (학습용)
├── 04-nextcloud-rhwp-connector/   ← NextCloud 앱 (crdt.js, editor.js)
├── 05-nextcloud-onlyoffice/       ← NextCloud + OnlyOffice 인프라 참고
├── 06-wiki-docs/                  ← 운영 위키 문서
├── server/                        ← 초기 프로토타입 (Node.js, 보존용)
├── README.md                      ← 이 파일
└── README-infra.md                ← 인프라 아키텍처 문서
```

## 렌더링 버그 목록

### 테스트 환경
- **테스트 파일**: 전북도청 실무 HWPX (306페이지, 249,568글자)
- **비교 기준**: 한컴오피스 뷰어
- **rHWP 버전**: v0.7.2 (edwardkim/rhwp fork)

### 발견된 버그

#### 🔴 A. 콘텐츠 누락/미렌더링

| # | 증상 | 위치 | 비고 |
|---|------|------|------|
| A-1 | 표 서식 장식 바(파란색 가로선) 미표시 | 표지 | 표 배경/테두리 장식 요소 |
| A-2 | 업무협약서 이미지 완전 누락 | 36p 근처 | 특정 이미지 타입 미지원 추정 |
| A-3 | 꺾쇠 괄호(〈〉) 기호 누락 | 다수 | 특수 유니코드 문자 |
| A-4 | 색칠된 네모 안 화살표 기호 깨짐 | 다수 | 특수 도형/기호 |
| A-5 | ▶ 삼각형 기호 미표시 | 다수 | 유니코드 기호 |
| A-6 | 목차 글자 그림자 효과 미적용 | 목차 | CharShape 그림자 속성 |

#### 🟡 B. 레이아웃/위치 어긋남

| # | 증상 | 위치 | 비고 |
|---|------|------|------|
| B-1 | 텍스트 줄바꿈 위치 불일치 | 전반 | 한컴 대비 단어 위치가 다른 줄에 배치됨 |
| B-2 | 이미지 위치 어긋남 | 6p 근처 | 성과분석 페이지 차트 위치 |
| B-3 | 텍스트 자간/행간 불일치로 글자 겹침 | 4p 근처 | 글자가 따닥따닥 붙는 현상 |
| B-4 | 글자 위치 전반적 차이 | 43p 근처 | 같은 파일인데 줄바꿈 지점이 다름 |

#### 🟠 C. 글꼴 문제

| # | 증상 | 위치 | 비고 |
|---|------|------|------|
| C-1 | 숫자에 다른 폰트 적용됨 | 5p 근처 | "15,170"이 HCI Poppy로 표시됨. 한글과 숫자의 폰트 분리 적용 안 됨 |

#### 🔵 D. 변환/회전 문제

| # | 증상 | 위치 | 비고 |
|---|------|------|------|
| D-1 | 가로 회전 페이지가 세로로 표시됨 | 8p 근처 | 네트워크 구성도 페이지가 찌그러져 보임 |

### 관련 edwardkim/rhwp 이슈

본가에 유사한 이슈가 다수 보고됨:
- [#425](https://github.com/edwardkim/rhwp/issues/425) — 텍스트/그림 겹침 (vpos 미사용)
- [#421](https://github.com/edwardkim/rhwp/issues/421) — BehindText 그림 후속 본문 배치 차이
- [#420](https://github.com/edwardkim/rhwp/issues/420) — 폰트 문제
- [#412](https://github.com/edwardkim/rhwp/issues/412) — 다단 줄간격 누락
- [#402](https://github.com/edwardkim/rhwp/issues/402) — inline 그림 겹침
- [#358](https://github.com/edwardkim/rhwp/issues/358) — 표 레이아웃 임포트 문제
- [#356](https://github.com/edwardkim/rhwp/issues/356) — 페이지 분기 오버플로
- [#248](https://github.com/edwardkim/rhwp/issues/248) — HWPX linesegarray 레이아웃 깨짐
- [#241](https://github.com/edwardkim/rhwp/issues/241) — 그림 때문에 공백 생기는 문제
- [#239](https://github.com/edwardkim/rhwp/issues/239) — 글자 깨짐
- [#238](https://github.com/edwardkim/rhwp/issues/238) — 글자 안 나옴, 겹침

## 이전 작업 이력 (Phase B~C)

초기에 이벤트 기반 동시편집을 독자적으로 구현한 이력:

### Phase B: 환경 구축 (완료)
- Rust 1.94.1 + wasm-pack 0.14.0 설치
- rHWP 소스 fork & WASM 빌드 파이프라인 구축

### Phase C: 이벤트 기반 동시편집 프로토타입 (완료)
- rHWP Rust 소스 직접 수정: `DocumentEvent`에 `text` 필드 추가
- `executeOperation` + `InsertTextCommand`/`DeleteTextCommand` 패턴 발견
- Node.js WebSocket 서버 + 클라이언트 구현
- 두 브라우저 탭에서 실시간 텍스트 동기화 검증

→ 이후 CRDT 기반 v3.0 완성을 확인하고, **렌더링 버그 수정** 방향으로 전환.

### 개발 중 배운 교훈

1. **executeOperation 패턴 필수** — `wasm.insertText()` 직접 호출은 화면 갱신 안 됨
2. **이벤트 스트림만으로는 동시편집 불완전** — 초기 상태 동기화(문서 스냅샷) 필요
3. **cargo check 통과 ≠ 런타임 정상** — Rust 대규모 리팩터링 시 런타임 테스트 필수
4. **rHWP의 IME 처리 구조** — `onCompositionStart/End`에서 조합 중 wasm 호출은 실시간 렌더링용

## 환경 설정

### 요구사항
- Rust 1.94+ (rustup)
- wasm-pack 0.14+
- Node.js 22+

### rHWP 빌드 & 실행

```bash
git submodule update --init --recursive

cd rhwp
wasm-pack build --target web --release    # 최초 약 20분

cd rhwp-studio
npm install
npx vite --host 0.0.0.0 --port 7700
```

브라우저에서 `http://localhost:7700` 접속 후 HWPX 파일 열어서 버그 확인.

## 참고 자료

- [rHWP 본가 (edwardkim/rhwp)](https://github.com/edwardkim/rhwp)
- [rHWP Issues](https://github.com/edwardkim/rhwp/issues) — 유사 버그 보고 다수
- [README-infra.md](./README-infra.md) — 인프라 아키텍처 문서
- [06-wiki-docs/](./06-wiki-docs/) — 운영 위키