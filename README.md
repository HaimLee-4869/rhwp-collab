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
          │  WebSocket (이벤트 스트림)            │
          └────────────┬──────────────────────────┘
                       │
              ┌────────▼─────────┐
              │ Node.js 서버     │
              │ (Express + ws)   │
              │  방(room) 기반   │
              │  브로드캐스트    │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │ NextCloud        │
              │ (WebDAV)         │
              │ HWP 파일 저장    │
              └──────────────────┘
```

## 핵심 기술

- **에디터 본체:** rHWP (Rust + WebAssembly) — [HaimLee-4869/rhwp](https://github.com/HaimLee-4869/rhwp) (fork)
- **동시편집 방식:** 이벤트 스트리밍 + executeOperation 패턴
  - rHWP의 `DocumentEvent`에 `text` 필드 추가하여 실시간 복원 가능
  - 원격 이벤트는 `inputHandler.executeOperation`으로 적용 (화면 자동 갱신)
- **충돌 처리:** 마지막 편집 우선 (Last-Write-Wins)
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

### 접속

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

### ✅ Phase C: 동시편집 구현 (완료)

#### C-1: rhwp-studio postMessage API 확장
- [x] WasmBridge에 `beginBatch`, `endBatch`, `getEventLog` 메서드 노출
- [x] main.ts postMessage 핸들러에 9개 메서드 추가
  - 이벤트 수집: `beginBatch`, `endBatch`, `getEventLog`
  - 원격 편집 적용: `insertText`, `deleteText`, `splitParagraph`, `mergeParagraph`
  - 파일 내보내기: `exportHwp`
  - 메타정보: `getDocumentInfo`

#### C-2: Node.js WebSocket 서버
- [x] Express + ws 기반 서버 (포트 7701)
- [x] 방(room) 기반 브로드캐스트
- [x] 클라이언트 HTML (iframe + WebSocket)
- [x] 자동 재연결 & 로그 패널

#### C-2+: rHWP 소스 직접 수정 (컨트리뷰션급)
- [x] `DocumentEvent::TextInserted`에 `text: String` 필드 추가
- [x] `DocumentEvent::TextDeleted`에 `text: String` 필드 추가
- [x] JSON 이스케이프 헬퍼 함수 추가
- [x] 편집/머리말/각주 핸들러 업데이트 (4개 파일)
- [x] WASM 재빌드 성공

#### C-2++: executeOperation 패턴 적용
- [x] `insertText`, `deleteText` case를 `inputHandler.executeOperation` 활용으로 재작성
- [x] `InsertTextCommand`, `DeleteTextCommand` 사용으로 화면 자동 갱신 구현

#### C-3: 동시편집 실제 작동 확인
- [x] 두 브라우저 탭에서 실시간 텍스트 동기화 검증
- [x] 한글 IME 조합 과정 포함 완벽 복원
- [x] 무한루프 방지 (endBatch/beginBatch 트릭)

### 🚧 Phase C 확장 (진행 예정)
- [ ] 표 이벤트 (`TableRowInserted`, `TableRowDeleted`, 등)
- [ ] 그림 이벤트 (`PictureInserted`, `PictureDeleted`, 등)
- [ ] 서식 이벤트 (`CharFormatChanged`, `ParaFormatChanged`)
- [ ] 한글 IME 조합 과정 필터링 (화면 깜빡임 제거)
- [ ] 유령 사용자 해결 (WebSocket heartbeat)

### 🚧 Phase D: NextCloud 연동 (예정)
- [ ] WebDAV로 HWP 파일 로드/저장
- [ ] NextCloud 커스텀 앱(PHP) 작성
- [ ] HWP 파일 클릭 → 에디터 라우팅
- [ ] 세션 시작 시 현재 문서 상태 동기화

## 현재 지원 이벤트

| 이벤트 타입 | 지원 | 비고 |
|------------|------|------|
| TextInserted | ✅ | `text` 필드로 정확 복원 |
| TextDeleted | ✅ | 삭제된 텍스트 보존 |
| ParagraphSplit | ✅ | 엔터 키 |
| ParagraphMerged | ✅ | 백스페이스로 문단 병합 |
| TableRowInserted | ❌ | Phase C 확장 예정 |
| TableRowDeleted | ❌ | Phase C 확장 예정 |
| PictureInserted | ❌ | Phase C 확장 예정 |
| CharFormatChanged | ❌ | Phase C 확장 예정 |
| ParaFormatChanged | ❌ | Phase C 확장 예정 |
| 기타 | ❌ | 순차 구현 |

## 알려진 이슈

- **화면 깜빡임**: 한글 IME 조합 과정의 이벤트가 모두 전송되어 상대방 화면에서 조합 과정이 보임 (조합 완료 후에만 전송하도록 최적화 필요)
- **유령 사용자**: WebSocket 연결 끊김 감지 실패로 접속자 수가 부정확하게 누적 (heartbeat 미구현)
- **문단 번호 렌더링 누락**: 일부 페이지에서 `1.`, `2.` 등이 안 보이는 경우 — rHWP v0.7 조판 엔진 한계

## 참고 자료

- [rHWP 본가 (edwardkim/rhwp)](https://github.com/edwardkim/rhwp)
- [OnlyOffice NextCloud 앱 (참고용)](https://github.com/ONLYOFFICE/onlyoffice-nextcloud)
- [NextCloud 개발 문서](https://docs.nextcloud.com/server/latest/developer_manual/)
- [wasm-pack 문서](https://rustwasm.github.io/docs/wasm-pack/)

## 팀

전북대학교 SW중심대학 캡스톤디자인 2026 — rHWP 동시편집 담당