# 한글(HWP) 동시편집 시스템 — 프로덕션 소스 패키지

전북AI(ai.jb.go.kr) 프로덕션에서 운영 중인 **한글(HWP) 실시간 동시편집** + **Nextcloud/OnlyOffice 문서 협업** 시스템 전체 소스/설정 모음입니다.

작성일: 2026-04-28
대상: 한글 동시편집 구현 학습/참고용
원본 운영 환경: 전북AI 프로덕션 (192.168.0.8 + 192.168.0.201 2-서버 구성)

---

## 1. 패키지 구성

```
rhwp-collab-package/
├── README.md                          ← 이 파일 (전체 가이드)
├── 01-rhwp-studio/                    ← rHWP 에디터 협업 브릿지 (TypeScript)
│   ├── iframe-collab-bridge.ts        ★ Nextcloud iframe 통신 핵심
│   ├── collaboration.ts               ← 협업 세션 관리
│   ├── yjs-bridge.ts                  ← Yjs CRDT 브릿지 (대안 구현)
│   ├── event-bus.ts                   ← 내부 이벤트 시스템
│   └── types.ts                       ← 공통 타입 정의
│
├── 02-rhwp-collab-server/             ← Python WebSocket 서버 (현행 프로덕션)
│   ├── server.py                      ★ Lamport-Clock CRDT 서버
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── 03-rhwp-yjs-server/                ← Node.js Yjs 서버 (대안)
│   ├── server.js                      ← y-websocket 기반
│   └── docker-compose.yml
│
├── 04-nextcloud-rhwp-connector/       ← Nextcloud 앱 (rhwp_connector v3.0.7)
│   ├── appinfo/
│   │   ├── info.xml                   ← 앱 메타데이터
│   │   └── routes.php
│   ├── js/
│   │   ├── crdt.js                    ★ 클라이언트 CRDT 구현
│   │   ├── editor.js                  ★ WebSocket 연결 + postMessage 브릿지
│   │   ├── files.js                   ← Files 앱 액션 후킹
│   │   └── viewer.js
│   ├── css/                           ← 원격 커서 스타일
│   ├── lib/
│   │   ├── AppInfo/Application.php
│   │   ├── Controller/EditorController.php
│   │   ├── Listener/                  ← Vue Files 앱 이벤트 후킹
│   │   └── Settings/                  ← 관리자 설정
│   └── templates/editor.php           ← iframe 호스팅 페이지
│
├── 05-nextcloud-onlyoffice/           ← Nextcloud + OnlyOffice 인프라
│   ├── docker-compose.nextcloud.yml   ← 전체 스택 정의
│   ├── onlyoffice-local.json          ★ JWT/캐시 핵심 설정
│   ├── onlyoffice-entrypoint.sh       ← 권한 자동 수정
│   ├── CallbackController.php.patched ← OnlyOffice 8.x JWT 우회 패치
│   ├── nextcloud-sso/                 ← OWI ↔ Nextcloud SSO 브릿지
│   │   ├── app.py, auth.py, sync_users.py
│   │   └── Dockerfile
│   └── sync-owi-to-nextcloud.sh       ← LDAP 사용자 자동 동기화
│
└── 06-wiki-docs/                      ← 위키 운영 문서
    ├── rhwp-collab.md                 ← rHWP 협업 위키 문서
    ├── nextcloud-onlyoffice.md        ← Nextcloud+OnlyOffice 위키 문서
    └── hwp-bridge.md                  ← HWP COM Bridge (참고)
```

---

## 2. 시스템 전체 구조

### 2.1 두 가지 협업 트랙

이 시스템은 **두 종류의 동시편집**을 동시에 운영합니다.

| 트랙 | 대상 포맷 | 엔진 | 설명 |
|------|-----------|------|------|
| **A. rHWP 협업** | HWP/HWPX | 자체 CRDT (Python WS) | 한글 파일을 Nextcloud iframe에서 직접 편집 |
| **B. OnlyOffice 협업** | DOCX/XLSX/PPTX | OnlyOffice DocumentServer | 표준 Office 포맷 동시편집 |

학생이 구현하려는 것이 "한글(HWP) 동시편집"이라면 **트랙 A가 핵심**이지만, Nextcloud + OnlyOffice 트랙도 같이 봐야 하는 이유:
- **인증/SSO 인프라가 같다** — Nextcloud 컨테이너, nginx, JWT 시크릿, 사용자 동기화는 공통
- **OnlyOffice는 비교 기준** — JWT 검증 흐름, 콜백 처리, iframe 통합 패턴이 rHWP 구현에 직접 적용됨
- **CallbackController 패치** — OnlyOffice 8.x JWT 우회 방식이 rhwp_connector의 인증 단순화에 모범사례

### 2.2 데이터 흐름 (rHWP 협업)

```
사용자 A (브라우저)                    사용자 B (브라우저)
  │                                       ▲
  │ 1. 키 입력                            │ 5. CRDT 병합 후 렌더
  ▼                                       │
┌───────────────────────┐         ┌───────────────────────┐
│ rHWP Studio (iframe)  │         │ rHWP Studio (iframe)  │
│  iframe-collab-bridge │         │  iframe-collab-bridge │
└──────┬────────────────┘         └────────────────────▲──┘
       │ postMessage(rhwp-edit)        postMessage     │
       ▼                                                │
┌───────────────────────┐         ┌───────────────────────┐
│ Nextcloud rhwp_       │         │ Nextcloud rhwp_       │
│ connector (editor.js) │         │ connector (editor.js) │
│  - crdt.js 적용       │         │  - crdt.js 병합       │
└──────┬────────────────┘         └────────────────────▲──┘
       │ WebSocket: type=operations                     │
       │ {siteId, counter, paraId, type, data}          │
       ▼                                                │
       └────────► rhwp-collab Server (Python) ─────────┘
                  - operation 시퀀스 부여
                  - 다른 클라이언트로 브로드캐스트
                  - 재연결 시 since_seq 동기화
                  - 최근 2000 op 히스토리 유지
```

### 2.3 핵심 설계 원칙

1. **iframe 격리** — rHWP Studio는 자체 도메인의 정적 파일로 호스팅되고, Nextcloud는 iframe으로 임베딩. `postMessage`로만 통신 → 보안/CORS 분리
2. **CRDT는 클라이언트에서** — 서버는 단순 브로드캐스트 + 시퀀스 부여만. 충돌 해결은 각 클라이언트의 `crdt.js`가 Lamport Clock + siteId 사전순으로 결정론적 처리
3. **Operation 배치** — 50ms 윈도우로 묶어서 전송 → 빠른 타이핑 시 메시지 폭주 방지
4. **재연결 복구** — `/sessions/{file_id}/operations?since_seq=N` REST 엔드포인트로 누락분 보충
5. **세션 정리** — 마지막 사용자가 나가면 자동 GC

---

## 3. 컴포넌트별 상세

### 3.1 rHWP Studio (`01-rhwp-studio/`)

**역할**: HWP 파일을 브라우저에서 편집하는 메인 에디터 (Rust → WASM)

**iframe-collab-bridge.ts 동작**:
- 부모 창(Nextcloud)에서 `rhwp-enable-collab` 메시지 수신 → 협업 모드 활성화
- 로컬 편집 발생 시 `command-executed` 이벤트 → JSON 직렬화 → `postMessage('rhwp-edit', ...)` 부모로 전송
- 부모로부터 `rhwp-apply-edit` 수신 → `isApplyingRemote = true` 플래그 설정 후 명령 재실행 (무한 루프 방지)

**지원 명령** (모두 `EditCommand` 서브클래스):
- `InsertTextCommand` / `DeleteTextCommand`
- `InsertLineBreakCommand` / `InsertTabCommand`
- `SplitParagraphCommand` / `MergeParagraphCommand`

**siteId**: 클라이언트마다 고유한 ID (예: `site-abc123`). 페이지 로드 시 한 번 생성하여 sessionStorage에 보관.

**collaboration.ts**: 고수준 세션 관리 (참여자 목록, 커서 위치 동기화).

**yjs-bridge.ts**: 대안 CRDT 라이브러리(Yjs) 통합 코드. 현행 프로덕션은 자체 CRDT(`crdt.js`)를 쓰지만, Yjs로 전환할 경우 사용.

### 3.2 rhwp-collab 서버 (`02-rhwp-collab-server/`)

**언어/런타임**: Python 3 + FastAPI + uvicorn
**포트**: 8765 (컨테이너 내부) → nginx에서 `wss://ai.jb.go.kr/rhwp-collab/` 로 프록시
**컨테이너**: `rhwp-collab` (192.168.0.8 서버)

**WebSocket 프로토콜**:

| 클라이언트 → 서버 | 동작 |
|-------------------|------|
| `{type:"join", userId, userName, crdtSiteId}` | 세션 입장 |
| `{type:"operations", operations:[{type, siteId, counter, paraId, data}]}` | CRDT op 배치 전송 |
| `{type:"cursor", position}` | 커서 위치 공유 |
| `{type:"sync_document", targetWsId, document}` | 신규 사용자에게 문서 전송 |
| `{type:"request_sync"}` | 전체 히스토리 재요청 |
| `{type:"ping"}` | keep-alive |

| 서버 → 클라이언트 | 동작 |
|-------------------|------|
| `{type:"joined", users, operations, lastSeq, needSync}` | 입장 응답 + 히스토리 |
| `{type:"operations", userId, operations, lastSeq}` | 다른 사용자 op 브로드캐스트 |
| `{type:"sync_request", targetWsId}` | 호스트에게 신규 사용자용 문서 전송 요청 |
| `{type:"load_document", document}` | 신규 사용자에게 문서 전달 |
| `{type:"user_joined" / "user_left", users}` | 참여자 변경 알림 |

**REST 엔드포인트**:
- `GET /health` — 헬스체크 (active sessions, total users)
- `GET /sessions` — 활성 세션 목록
- `GET /sessions/{file_id}/operations?since_seq=N` — 재연결 동기화

**히스토리 정책**: 세션당 최근 2000 op 유지. 그 이상은 자동 폐기. 이 한도는 server.py의 `if len(session.operations) > 2000` 라인에서 조정 가능.

### 3.3 rhwp-yjs 서버 (`03-rhwp-yjs-server/`)

**대안 구현**: `y-websocket`을 그대로 사용하는 단순 서버. 현행은 자체 CRDT지만, 학생이 표준 Yjs로 구현하려면 이쪽이 출발점.

### 3.4 rhwp_connector (`04-nextcloud-rhwp-connector/`)

**Nextcloud 앱**. PHP + JavaScript + CSS로 구성.

**주요 파일**:

| 파일 | 역할 |
|------|------|
| `js/files.js` | Files 앱에서 HWP 파일 클릭 시 `viewer.js` 호출하도록 액션 등록 |
| `js/editor.js` | iframe에 rHWP Studio 로드 + WebSocket 연결 + postMessage 브릿지 |
| `js/crdt.js` | 문단별 CRDT 구현. 문자 ID = `{siteId, clock, char}`, 충돌은 clock → siteId 순으로 결정 |
| `js/viewer.js` | 파일 클릭 핸들러 → editor 페이지로 라우팅 |
| `css/editor.css` | 원격 커서 라벨, 캐럿, 깜빡임 애니메이션 |
| `lib/Controller/EditorController.php` | `/apps/rhwp_connector/{fileId}` 라우트 처리 |
| `lib/Listener/LoadAdditionalScriptsListener.php` | Files 앱 로드 시 JS 자동 주입 |
| `lib/Listener/BeforeTemplateListener.php` | 템플릿 렌더 직전 후킹 |
| `templates/editor.php` | iframe 호스팅 HTML |

**Nextcloud 30+ Vue Files 앱 호환성**: 새 API에서는 PHP 측 액션 등록이 안 먹음. `files.js`는 DOM 클릭 인터셉터로 작동.

**서브디렉토리 설치**: `OC.webroot`로 baseURL 결정 — Nextcloud가 `/nextcloud/`에 설치된 경우에도 동작.

### 3.5 Nextcloud + OnlyOffice 인프라 (`05-nextcloud-onlyoffice/`)

**docker-compose.nextcloud.yml**: 전체 스택 정의
- `nextcloud` — Apache + PHP 8.x
- `onlyoffice` — DocumentServer 8.x
- `nextcloud-sso` — OWI(Open WebUI) ↔ Nextcloud 자동 로그인 브릿지

**onlyoffice-local.json — 핵심 설정 포인트**:
```json
"token.enable.browser": false        // ← api.js 접근에 JWT 불필요
"token.enable.request.inbox": true   // ← 들어오는 요청에 JWT 검증
"token.enable.request.outbox": false // ← OnlyOffice 8.x는 발신 JWT 미지원
"allowPrivateIPAddress": true        // ← Docker 내부 IP 허용
"secretString": "verysecretstring"   // ← nginx secure_link와 일치 필수
```

**OnlyOffice 8.x JWT 우회 패치 (`CallbackController.php.patched`)**:
```php
// Line ~249
$header = \OC::$server->getRequest()->getHeader($this->config->jwtHeader());
if (!empty($header)) {
    // JWT 있으면 검증
} else {
    $this->logger->debug("Download without jwt header - hash is valid, proceeding");
    // JWT 없어도 hash 유효하면 진행
}
```
> ⚠️ Nextcloud OnlyOffice 앱 업데이트 시 패치가 덮어씌워짐 — 업데이트 후 재패치 필요

**nginx 설정 (별도 — 도커 외부)**: `/cache/` 경로 프록시 필수. 누락 시 "다운로드하지 못했습니다" 에러.

### 3.6 위키 문서 (`06-wiki-docs/`)

운영 매뉴얼 원본. 트러블슈팅 + 설정값이 가장 잘 정리된 자료. 학생은 **이 디렉토리부터 읽는 것을 추천**.

---

## 4. 학생 환경에서 재현하는 절차

### 4.1 최소 구성 (rHWP 협업만)

1. **rhwp-collab 서버 띄우기**
   ```bash
   cd 02-rhwp-collab-server
   docker compose up -d
   curl http://localhost:8765/health   # 확인
   ```

2. **Nextcloud 띄우기** (개인 학습용은 공식 nextcloud Docker 이미지로 충분)
   ```bash
   docker run -d --name nc -p 8080:80 nextcloud
   ```

3. **rhwp_connector 설치**
   ```bash
   docker cp 04-nextcloud-rhwp-connector nc:/var/www/html/custom_apps/rhwp_connector
   docker exec nc chown -R www-data:www-data /var/www/html/custom_apps/rhwp_connector
   docker exec --user www-data nc php occ app:enable rhwp_connector
   ```

4. **rHWP Studio 빌드 + 정적 호스팅**
   ```bash
   # rhwp 저장소에서 (이 패키지에는 빌드 산출물 미포함)
   cd rhwp/rhwp-studio
   npm install && npm run build
   # dist/ 결과물을 nginx 등으로 공개. iframe-collab-bridge.ts는 이 빌드에 포함됨.
   ```

5. **연결**: Nextcloud 관리자 설정 → rHWP Connector → Studio URL + Collab WebSocket URL 입력

### 4.2 전체 구성 (OnlyOffice 포함)

`05-nextcloud-onlyoffice/docker-compose.nextcloud.yml`을 그대로 사용. 단, 환경변수(JWT 시크릿, DB 비밀번호, 외부 도메인)는 학생 환경에 맞게 수정 필수.

---

## 5. 트러블슈팅 (실제 운영 중 만난 문제들)

### 5.1 HWP 클릭 시 다운로드만 됨
- **원인**: Nextcloud 30+의 Vue Files 앱이 PHP 액션 무시
- **해결**: `files.js`의 DOM 클릭 인터셉터가 작동해야 함. Ctrl+F5로 캐시 비우고 재시도

### 5.2 협업 서버 연결 안 됨
```bash
curl -sf http://192.168.0.8:8765/health         # 헬스체크
docker port rhwp-collab                          # 0.0.0.0:8765 이어야 함 (127.0.0.1이면 외부 접근 불가)
```

### 5.3 WASM 로딩 에러 (`__wbindgen_malloc`)
- rHWP Studio의 `wasmReady` 플래그 확인
- postMessage 핸들러에서 WASM 초기화 대기 로직 필요

### 5.4 OnlyOffice "다운로드하지 못했습니다"
- nginx `/cache/` 경로 누락 → `06-wiki-docs/nextcloud-onlyoffice.md` 참고
- OnlyOffice DB의 `task_result` 테이블에 `status=5` (에러) 캐시. 삭제 명령은 위키 문서 참고

### 5.5 iframe 제한
- rHWP Studio가 iframe 안에서만 협업 모드 활성화 (`window.parent !== window` 감지)
- 독립 실행 시 비활성화됨 — 의도된 동작

### 5.6 Operation 배치 타이밍
- 50ms로 묶어서 전송. 너무 짧으면 메시지 폭주, 너무 길면 응답성 저하
- `editor.js`의 `BATCH_INTERVAL` 상수에서 조정

---

## 6. CRDT 동작 원리 (학습 핵심)

### 6.1 문자 ID
```javascript
{
  siteId: "site-abc123",   // 클라이언트 고유 ID
  clock: 42,               // Lamport 타임스탬프
  char: "가"               // 실제 문자
}
```

### 6.2 충돌 해결 (3단계)
1. **Lamport Clock 비교**: 큰 값이 뒤에
2. **siteId 사전순 비교**: clock 같으면 문자열 비교
3. **결정론적**: 모든 클라이언트가 동일 순서 도달 보장

### 6.3 문단 단위 분리
- 전체 문서를 하나의 거대한 시퀀스로 두면 op 비용 폭증
- **문단별로 독립 시퀀스** 유지 → `paraId`로 구분
- `splitParagraph` / `mergeParagraph`는 메타 op로 처리

### 6.4 왜 Yjs 안 쓰고 자체 구현?
- Yjs는 일반 Y.Doc 기반인데, rHWP는 자체 IR(중간 표현)을 가짐
- IR 변환을 거치면 Yjs의 효율적 인코딩 이점이 상쇄됨
- **결론**: 학습용으로는 Yjs 추천 (`03-rhwp-yjs-server/`), 운영은 자체 CRDT
- 이 패키지에 두 구현이 다 있는 이유

---

## 7. 보안 주의사항

학생이 이 코드를 자체 환경에 적용할 때 **반드시 변경할 것**:

1. **JWT 시크릿**: `JB_OnlyOffice_JWT_Secret_2026!` ← 절대 그대로 쓰지 말 것
2. **DB 비밀번호**: docker-compose.yml의 `POSTGRES_PASSWORD` 등
3. **secure_link_secret**: nginx와 OnlyOffice의 `verysecretstring` ← 다른 값으로 교체
4. **CORS**: rhwp-collab 서버는 `allow_origins=["*"]`로 열려있음. 운영 시에는 도메인 제한
5. **인증**: 현재 WebSocket에 인증 없음. Nextcloud 세션 토큰 검증 추가 권장

---

## 8. 추가 참고 자료

| 자료 | 위치 |
|------|------|
| 위키 (HTML, 인증 필요) | https://ai.jb.go.kr/wiki/services/rhwp-collab/ |
| 위키 소스 (md) | `06-wiki-docs/` |
| rHWP 본체 (Rust) | https://github.com/edwardkim/rhwp |
| OnlyOffice DocumentServer | https://github.com/ONLYOFFICE/DocumentServer |
| Nextcloud OnlyOffice 앱 | https://github.com/ONLYOFFICE/onlyoffice-nextcloud |

---

## 9. 질문/이슈

이 패키지에 대한 질문은 윤성호(전북AI)에게 문의.
프로덕션 코드를 정리한 것이라 학생 환경에 그대로 동작하지 않을 수 있음 — 필요한 부분만 발췌해서 사용하세요.
