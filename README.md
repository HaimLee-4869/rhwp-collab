# rHWP + NextCloud 동시편집

전북특별자치도청 생성형 AI 시스템 고도화 캡스톤 과제의 일환으로, NextCloud에서 HWP/HWPX 파일을 여러 사용자가 동시에 편집할 수 있는 시스템 구축.

## 배경

- **현재 상황:** NextCloud + OnlyOffice 연동으로 xlsx/docx는 동시편집 가능하나, HWP/HWPX는 다운로드만 됨
- **목표:** rHWP(오픈소스 HWP 에디터) + NextCloud 연동 + 동시편집 레이어 구현
- **rHWP 버전:** v0.7.2 (동시편집은 v2.0 로드맵이므로 직접 구현)

## 아키텍처

```
┌─────────────────────┐                ┌─────────────────────┐
│  사용자 A           │                │  사용자 B           │
│  ┌──────────────┐   │                │  ┌──────────────┐   │
│  │ client.html  │   │                │  │ client.html  │   │
│  │  ┌────────┐  │   │                │  │  ┌────────┐  │   │
│  │  │ iframe │  │   │                │  │  │ iframe │  │   │
│  │  │(rhwp-  │  │   │                │  │  │(rhwp-  │  │   │
│  │  │studio) │  │   │                │  │  │studio) │  │   │
│  │  └────────┘  │   │                │  │  └────────┘  │   │
│  └──────┬───────┘   │                │  └──────┬───────┘   │
└─────────┼───────────┘                └─────────┼───────────┘
          │                                       │
          │  WebSocket                            │
          │  (이벤트 스트림 + 문서 스냅샷)        │
          └────────────┬──────────────────────────┘
                       │
              ┌────────▼─────────┐
              │ Node.js 서버     │
              │ (Express + ws)   │
              │  방(room) 기반   │
              │  문서 상태 관리  │
              │  이벤트 릴레이   │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │ NextCloud        │
              │ (WebDAV)         │
              │ HWP 파일 저장    │
              └──────────────────┘
```

## 동시편집 동기화 전략

본 프로젝트는 **하이브리드 동기화** 방식을 채택한다:

1. **문서 스냅샷 동기화 (초기 상태 일치)**
   - 새 사용자 접속 시 서버에서 현재 문서 바이너리(HWP)를 받아 `loadFile`로 로드
   - 주기적(30초)으로 `exportHwp`로 서버에 최신 상태 업로드

2. **이벤트 스트림 (실시간 변경 전파)**
   - rHWP의 `DocumentEvent` JSON을 WebSocket으로 교환
   - `executeOperation` + Command 패턴으로 화면 자동 갱신

3. **충돌 처리:** 마지막 편집 우선 (Last-Write-Wins)
   - OT/CRDT는 학부 캡스톤 범위 밖
   - 같은 위치 동시 편집 시 나중 편집이 우선

## 핵심 기술

- **에디터 본체:** rHWP (Rust + WebAssembly) — [HaimLee-4869/rhwp](https://github.com/HaimLee-4869/rhwp) (fork)
- **rHWP 직접 수정 (컨트리뷰션급):**
  - `DocumentEvent::TextInserted/TextDeleted`에 `text: String` 필드 추가
  - JSON 직렬화 시 실제 텍스트 포함 → 원격 클라이언트에서 정확한 복원 가능
- **rhwp-studio 확장:**
  - postMessage API 9개 추가 (beginBatch, endBatch, insertText, deleteText 등)
  - `inputHandler.executeOperation` + `InsertTextCommand`/`DeleteTextCommand` 활용
  - 원격 편집 적용 시 `afterEdit()` 자동 호출로 화면 즉시 갱신
- **서버:** Node.js (Express 5 + ws)
- **파일 저장:** NextCloud WebDAV (예정)
- **연결 앱:** NextCloud custom PHP app (예정)

## 환경 설정

### 요구사항
- Rust 1.94+ (rustup)
- wasm-pack 0.14+
- Node.js 22+
- wasm32-unknown-unknown 타겟

### 빌드 & 실행

```bash
# 최초 clone 시 submodule 초기화
git submodule update --init --recursive

# 1) rHWP WASM 빌드 (최초 20분, 이후 증분 빌드)
cd rhwp
wasm-pack build --target web --release

# 2) rhwp-studio 개발 서버 (터미널 1)
cd rhwp-studio
npm install
npx vite --host 0.0.0.0 --port 7700

# 3) 동시편집 서버 (터미널 2)
cd ../../server
npm install
node index.js
```

### 접속 테스트

두 개의 브라우저 탭을 동시에 열어 테스트:
- `http://localhost:7701/client.html?room=test`
- `http://localhost:7701/client.html?room=test`

한 탭에서 타이핑하면 다른 탭에 실시간으로 반영됨.

## 진행 상황

### ✅ Phase B: 환경 구축 (완료)
- [x] Rust 1.94.1 stable 설치
- [x] wasm-pack 0.14.0 설치
- [x] rHWP 소스 포크 & WASM 빌드 (3.5MB optimized)
- [x] rhwp-studio Vite 서버 실행
- [x] 브라우저에서 에디터 렌더링 확인
- [x] 도청 HWPX 파일 렌더링 테스트 통과

### ✅ Phase C: 이벤트 기반 동시편집 (완료)

#### C-1: rhwp-studio postMessage API 확장
- [x] WasmBridge에 `beginBatch`, `endBatch`, `getEventLog` 메서드 노출
- [x] main.ts postMessage 핸들러에 9개 메서드 추가

#### C-2: Node.js WebSocket 서버
- [x] Express + ws 기반 서버 (포트 7701)
- [x] 방(room) 기반 브로드캐스트
- [x] 클라이언트 HTML (iframe + WebSocket + 로그 패널)

#### C-2+: rHWP Rust 소스 직접 수정
- [x] `DocumentEvent::TextInserted/TextDeleted`에 `text: String` 필드 추가
- [x] JSON 이스케이프 헬퍼 함수 추가
- [x] 편집/머리말/각주 핸들러 업데이트 (4개 파일)
- [x] WASM 재빌드 성공

#### C-2++: executeOperation 패턴 적용
- [x] `insertText`, `deleteText`를 `inputHandler.executeOperation` + Command 패턴으로 재작성
- [x] 화면 자동 갱신 구현 (`afterEdit()` 자동 호출)

#### C-3: 동시편집 실제 작동 확인
- [x] 두 브라우저 탭에서 실시간 텍스트 동기화 검증
- [x] 한글 IME 조합 과정 포함 텍스트 복원 확인
- [x] 무한루프 방지 (endBatch/beginBatch 트릭)

### 🚧 Phase E: 문서 상태 동기화 (진행 예정 — 최우선)

현재 이벤트 기반 동시편집은 **두 사용자가 동시에 빈 문서에서 시작할 때만** 정상 동작. 한 사용자가 먼저 편집한 후 다른 사용자가 접속하면 **문서 상태 불일치**로 에러 발생.

- [ ] E-1: 서버 측 문서 저장소 (rooms별 HWP 바이너리 보관)
- [ ] E-2: 접속 시 현재 문서 스냅샷 다운로드 & `loadFile` 적용
- [ ] E-3: 주기적(30초) `exportHwp` → 서버 업로드
- [ ] E-4: 통합 테스트 (선접속 편집 후 후접속 동기화)

### 🚧 Phase F: 인프라 개선
- [ ] F-1: WebSocket heartbeat (유령 사용자 해결)
- [ ] F-2: 접속/해제 로그 정확도 향상

### 🚧 Phase D: NextCloud 연동 (미션 완수)
- [ ] D-1: WebDAV로 HWP 파일 로드/저장
- [ ] D-2: NextCloud 커스텀 앱(PHP) 작성
- [ ] D-3: HWP 파일 클릭 → 에디터 라우팅
- [ ] D-4: 통합 테스트

### 🚧 Phase G: 동시편집 확장 (시간 남으면)
- [ ] G-1: 표 이벤트 (`TableRowInserted`, `TableRowDeleted`)
- [ ] G-2: 그림 이벤트 (`PictureInserted`, `PictureDeleted`)
- [ ] G-3: 서식 이벤트 (`CharFormatChanged`, `ParaFormatChanged`)
- [ ] G-4: 한글 IME 조합 과정 필터링 (화면 깜빡임 제거)

## 현재 지원 이벤트

| 이벤트 타입 | 실시간 동기화 | 스냅샷 동기화 | 비고 |
|------------|:---:|:---:|------|
| TextInserted | ✅ | ✅ | `text` 필드로 정확 복원 |
| TextDeleted | ✅ | ✅ | 삭제된 텍스트 보존 |
| ParagraphSplit | ✅ | ✅ | 엔터 키 |
| ParagraphMerged | ✅ | ✅ | 백스페이스로 문단 병합 |
| TableRowInserted | ❌ | 🚧 | Phase E 후 스냅샷으로 동기화 |
| PictureInserted | ❌ | 🚧 | Phase E 후 스냅샷으로 동기화 |
| CharFormatChanged | ❌ | 🚧 | Phase E 후 스냅샷으로 동기화 |
| 기타 | ❌ | 🚧 | Phase E 후 스냅샷으로 동기화 |

> **참고:** Phase E(문서 스냅샷 동기화) 완성 시, 이벤트로 개별 지원하지 않는 변경 사항도 주기적 스냅샷으로 동기화됨. 즉 표/그림/서식 변경도 최대 30초 이내에 상대방에게 반영.

## 알려진 이슈

### 치명적 (Phase E에서 해결 예정)
- **초기 상태 불일치:** 먼저 접속한 사용자의 편집 내용이 나중 접속자에게 전달되지 않음
- **문단 인덱스 엇갈림:** 한 쪽에서 엔터로 문단을 추가하면, 상대방 에디터에서 "문단 인덱스 범위 초과" 에러 발생

### UX 문제 (Phase G에서 개선 예정)
- **한글 IME 깜빡임:** 조합 과정(ㅇ→아→안)의 모든 이벤트가 전송되어 상대방 화면에서 조합 과정이 보임
- **유령 사용자:** WebSocket 연결 끊김 미감지로 접속자 수가 부정확하게 누적

### rHWP 본체 한계 (우리 범위 밖)
- **문단 번호 렌더링 누락:** 일부 페이지에서 `1.`, `2.` 등이 안 보이는 경우 — rHWP v0.7 조판 엔진 한계

## 개발 중 배운 교훈

1. **이벤트 스트림만으로는 동시편집 불완전** — 초기 상태 동기화(문서 스냅샷)가 반드시 필요
2. **executeOperation 패턴 필수** — `wasm.insertText()` 직접 호출은 화면 갱신 안 됨, `inputHandler.executeOperation` + Command 패턴 사용해야 `afterEdit()` 자동 호출
3. **cargo check 통과 ≠ 런타임 정상** — Rust 대규모 리팩터링(sed 치환 등) 시 런타임 테스트 필수
4. **rHWP의 IME 처리 구조** — `onCompositionStart/End`에서 조합 중 wasm 호출이 실시간 렌더링용으로 이루어짐 (조합 완료 시점의 Undo 기록만 별도)

## 참고 자료

- [rHWP 본가 (edwardkim/rhwp)](https://github.com/edwardkim/rhwp)
- [OnlyOffice NextCloud 앱 (참고용)](https://github.com/ONLYOFFICE/onlyoffice-nextcloud)
- [NextCloud 개발 문서](https://docs.nextcloud.com/server/latest/developer_manual/)
- [wasm-pack 문서](https://rustwasm.github.io/docs/wasm-pack/)

## 팀

전북대학교 SW중심대학 캡스톤디자인 2026 — rHWP 동시편집 담당