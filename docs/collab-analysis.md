# 한글·엑셀 동시편집 시스템 분석

> 분석 대상: `rhwp-collab-package-2026-04-28` (6개 폴더, 41개 파일, ~312KB)
> 분석일: 2026-05-30 · 읽기 전용 분석(코드 변경 0) · PPT 발표용 정리
> 표기: **[확인]** = 코드에서 직접 확인됨 / **[추측]** = 코드 정황상 추정 / **[미확인]** = 산출물 부재로 실동작 검증 불가

---

## 1. 한 줄 요약 + 헤드라인 (PPT 1슬라이드용)

> **"하나의 Nextcloud 위에서, 한글(HWP)은 자체 CRDT로·엑셀(XLSX)은 OnlyOffice로 — 둘 다 iframe + postMessage + WebSocket이라는 동일한 통합 패턴으로 실시간 동시편집한다."**

핵심 헤드라인 3가지:
1. **두 트랙, 하나의 인프라** — 한글은 직접 만든 CRDT 엔진(Track A), 엑셀은 검증된 외부 솔루션 OnlyOffice(Track B). 인증·SSO·Nextcloud 호스팅은 공유.
2. **"서버는 멍청하게, 클라이언트는 똑똑하게"** — 한글 협업 서버는 충돌 해결을 하지 않는다. 단순 시퀀스 부여 + 브로드캐스트만. 충돌 해결(CRDT)은 전부 브라우저에서.
3. **아키텍처가 진화 중** — 자체 Lamport CRDT(v3) → 표준 Yjs(v4)로 이전 중. 두 구현이 패키지에 공존하며, 협력자는 **Yjs를 추천**.

---

## 2. 전체 아키텍처

### 2.1 시스템 전체도 (텍스트 다이어그램)

```
                          ┌──────────────────────────────┐
   사용자 브라우저         │      Nextcloud (호스트)        │
 ┌──────────────────┐     │   nextcloud:30-apache         │
 │  Files 앱        │────▶│   - rhwp_connector (자체앱)   │
 │  (HWP/XLSX 클릭) │     │   - onlyoffice (외부앱)       │
 └──────────────────┘     │   - PostgreSQL16 + Redis7     │
         │                └──────────────┬────────────────┘
         │                               │
    ┌────┴───────────┐         ┌─────────┴──────────┐
    ▼                ▼         ▼                    ▼
┌─────────┐   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│ Track A │   │  Track B    │  │ OWI SSO 브릿지│  │  인증 백엔드  │
│ 한글HWP │   │  엑셀XLSX   │  │ nextcloud-sso │  │  OWI(외부)   │
└────┬────┘   └──────┬──────┘  └──────────────┘  └──────────────┘
     │               │
     ▼               ▼
┌──────────────┐ ┌──────────────────┐
│ iframe:      │ │ iframe:          │
│ rHWP Studio  │ │ OnlyOffice       │
│ (Rust→WASM)  │ │ DocumentServer8.1│
└──────┬───────┘ └────────┬─────────┘
       │ WebSocket         │ JWT + 콜백
       ▼                   ▼
┌──────────────────┐  ┌──────────────────┐
│ 한글 협업 서버    │  │ OnlyOffice 내부   │
│ ① Python(자체)   │  │ DocService       │
│ ② Node.js(Yjs)   │  │ (CoAuthoring)    │
│   포트 8765/1234 │  │ 포트 8087        │
└──────────────────┘  └──────────────────┘
```

### 2.2 컴포넌트별 역할 요약 표

| 컴포넌트 | 폴더 | 언어/런타임 | 역할 | 트랙 |
|---|---|---|---|---|
| rHWP Studio 브릿지 | 01 | TypeScript(→WASM 빌드) | iframe 안 에디터, 편집 이벤트 캡처/적용 | A |
| 한글 협업 서버(자체) | 02 | Python/FastAPI | op 시퀀스 부여 + 브로드캐스트 (충돌해결 X) | A |
| 한글 협업 서버(Yjs) | 03 | Node.js/y-websocket | Yjs 표준 동기화 (대안, 추천) | A |
| rhwp_connector | 04 | PHP + JS | Nextcloud 앱: 파일클릭 후킹 + iframe 호스팅 + WS 브릿지 | A |
| OnlyOffice 연동 | 05 | PHP패치 + 설정 + Python | XLSX/DOCX 동시편집 + JWT + SSO | B |
| 운영 위키 | 06 | Markdown | 트러블슈팅·설정값 문서 | 공통 |

---

## 3. 한글(rHWP) 동시편집 트랙

### 3-1. 데이터 흐름 (사용자 키 입력 → 화면 반영)

**현행 v4.0 (Yjs 기반) 흐름** **[확인]** (`editor.js` 헤더 `v4.0 - Yjs 기반`):

```
[사용자 A: 키 입력]
   │
   ▼ rHWP Studio 엔진이 EditCommand 실행
[EventBus: 'command-executed' 발화]
   │
   ▼ (iframe 내부) yjs-bridge.ts 가 구독
[Command → SerializedOp 직렬화 → Y.Array<Y.Map> 에 push]
   │
   ▼ y-websocket provider 가 자동 전송
[Node.js Yjs 서버 (03) : CRDT 머지 + 다른 피어로 relay]
   │
   ▼ 사용자 B의 Y.Array.observe 콜백 발화
[원격 op → deserializeOperation → command.execute(wasm)]
   │
   ▼
[사용자 B 화면 반영]   +  awareness 로 참여자/커서 표시

   ┊ (병행 안전망) editor.js 가 3초마다 전체 문서를 export →
   ┊ simpleHash 비교 → 변하면 base64로 rhwp-collab(02)에 full_sync 브로드캐스트
```

> **핵심 관찰 [확인]**: 현행 시스템은 동기화 경로가 **2중**이다.
> ① **Yjs operation 동기화**(정밀, iframe 내부 yjs-bridge ↔ 03 서버)
> ② **3초 주기 전체문서 full_sync**(거칠지만 확실한 안전망, editor.js ↔ 02 서버)
> editor.js 주석이 직접 밝힘: *"Yjs operation 매핑이 불완전한 경우에 대비한 safety net"* (editor.js:142-143). 즉 op 단위 CRDT가 아직 완전히 신뢰되지 않아 전체 문서 폴링을 백업으로 깔아둔 상태. **[추측]** 이것이 협력자가 "Yjs를 더 추천"한 배경 — 자체 op 매핑이 불안정.

**구버전 v3 (자체 Lamport CRDT) 흐름** — `crdt.js` + `collaboration.ts` + 02 서버 조합. 패키지에 코드가 남아있으나 editor.js v4가 직접 호출하지 않음 **[확인: editor.js는 yjsConnect만 호출, DocumentCRDT 미사용]**.

### 3-2. iframe-collab-bridge.ts 핵심 로직 (코드 스니펫)

**(a) 에코 루프 방지 — 가장 중요한 설계** [확인]:
원격 편집을 적용할 때 `isApplyingRemote` 플래그를 세워, 그 적용이 다시 `command-executed`를 발화해도 재전송하지 않게 막는다.

```typescript
// 로컬 편집 → 부모로 전송 (subscribeToEdits)
this.eventBus.on('command-executed', (...args) => {
  const cmd = args[0] as EditCommand;
  if (!this.enabled || this.isApplyingRemote) return;  // ← 원격 적용 중이면 무시
  this.broadcastEdit(cmd);
});

// 원격 편집 적용 (applyRemoteEdit)
this.isApplyingRemote = true;
try {
  command.execute(this.wasm);
  this.eventBus.emit('document-changed');
} finally {
  this.isApplyingRemote = false;  // ← 적용 끝나면 해제
}
```

**(b) 부모 창으로 보내는 postMessage 형식** [확인] (`broadcastEdit`):

```typescript
window.parent.postMessage({
  type: 'rhwp-edit',
  operation: 'insertText',      // serializeCommand 결과
  paraId: 0,                    // 문단 인덱스
  charIndex: 5,                 // 문단 내 문자 오프셋
  text: '가',
  siteId: this.siteId,          // 클라이언트 고유 ID
  counter: ++this.operationCounter,  // 로컬 op 카운터
  timestamp: Date.now()
}, '*');                        // ← targetOrigin '*' (보안주의, 6장 참고)
```

**(c) 캡처하는 편집 이벤트 종류** [확인] (`serializeCommand`가 6종 EditCommand 처리):

| EditCommand | operation 문자열 | 페이로드 필드 |
|---|---|---|
| InsertTextCommand | `insertText` | paraId, charIndex, text |
| DeleteTextCommand | `deleteText` | paraId, charIndex, length, direction |
| InsertLineBreakCommand | `insertLineBreak` | paraId, charIndex |
| InsertTabCommand | `insertTab` | paraId, charIndex |
| SplitParagraphCommand | `splitParagraph` | paraId, charIndex |
| MergeParagraphCommand | `mergeParagraph` | paraId |

추가로 **커서**(`rhwp-cursor`)·**선택영역**(`rhwp-selection`)을 별도 메시지로 전송. 화면 좌표는 `.caret-line` / `.text-selection` DOM의 `getBoundingClientRect()`로 계산 [확인].

**(d) 인바운드(부모→iframe) 메시지 처리** [확인] (`setupMessageListener`):
- `rhwp-enable-collab` → 협업 활성화 + siteId 설정
- `rhwp-apply-edit` → 원격 편집 적용
- `rhwp-request-cursor` → 커서 위치 회신

> ⚠️ **주의 [확인]**: 이 파일의 `'rhwp-edit'` postMessage 프로토콜과, 실제 운영중인 `editor.js`의 `'rhwp-request'/'rhwp-response'` RPC(아래 3-4)는 **다른 프로토콜**이다. iframe-collab-bridge.ts는 "직접 op 전달" 방식이고, editor.js v4는 "메서드 호출(RPC) + Yjs는 iframe 내부에서 직접" 방식. 두 세대의 통합 방식이 패키지에 공존.

### 3-3. CRDT 충돌 해결 — Lamport Clock 자체 구현 (`crdt.js`)

자체 CRDT는 **문자 단위 ID + Lamport 시계 + siteId 결정론적 정렬**로 동작 [확인].

**(a) 문자 ID와 비교 함수 — 결정론의 핵심** [확인]:

```javascript
generateId() {
  return { site: this.siteId, counter: ++this.counter };  // 문자마다 고유 ID
}

compareIds(a, b) {
  if (a.counter !== b.counter) return a.counter - b.counter;  // ① Lamport 비교
  return a.site.localeCompare(b.site);                        // ② 같으면 siteId 사전순
}
```
→ 모든 클라이언트가 같은 (counter, siteId)에 대해 **항상 동일한 순서**에 도달 = 수렴 보장.

**(b) Lamport 시계 갱신** [확인] (원격 op 받을 때 자기 시계를 끌어올림):

```javascript
applyRemote(operation) {
  if (operation.counter && operation.counter >= this.counter) {
    this.counter = operation.counter + 1;   // ← Lamport clock 전진
  }
  ...
}
```

**(c) 삭제는 tombstone 방식** [확인]: 실제 배열에서 제거하지 않고 `deleted = true` 플래그만 세움(`localDelete`/`remoteDelete`). 화면 위치(visibleIndex)는 tombstone을 건너뛰며 계산. 삽입 위치는 `findInsertIndex`의 **이진탐색**으로 O(log n).

**(d) 문단 단위 분리 — `DocumentCRDT`** [확인]: 문서 전체를 하나의 거대 시퀀스로 두지 않고, **문단(paraId)마다 독립 CRDT 인스턴스**를 둠(`paragraphs: Map<paraId, CRDT>`). 문단 순서 자체도 별도 `orderCRDT`로 관리. 빠른 타이핑 시 op 비용 분산.

> **발표 포인트**: "서버가 아니라 각 브라우저가 똑같은 규칙(counter→siteId)으로 정렬하기 때문에, 네트워크 순서가 뒤섞여 도착해도 모두가 같은 문서로 수렴한다" — 이게 CRDT의 본질이고 이 코드가 그걸 30줄로 보여줌.

### 3-3b. 협업 서버(02 Python)의 실제 역할 — "CRDT를 하지 않는다" [확인]

README/위키는 "Lamport-Clock CRDT 서버"라 부르지만, 실제 `server.py`는 **충돌 해결 로직이 없다**. 하는 일:
1. `operation_seq`를 +1씩 부여해 op에 서버 시퀀스 매김 (server.py:237-239)
2. 보낸 사람 제외하고 그대로 **브로드캐스트** (server.py:251-257)
3. 최근 **2000개** op 히스토리 유지, 초과분 폐기 (server.py:244-245)
4. 신규 입장자에게 기존 사용자 문서 동기화 중계(`sync_request`/`load_document`)
5. 재연결 복구용 REST: `GET /sessions/{file_id}/operations?since_seq=N`

```python
# 충돌해결 아님 — counter는 그냥 저장만, 시퀀스만 서버가 부여
op = parse_operation(op_data, user)
op.seq = session.operation_seq           # 서버 시퀀스
session.operations.append(op)
await broadcast_to_session(session, {     # 단순 중계
    "type": "operations", "operations": [op.to_dict() for op in processed_ops], ...
}, exclude_id=ws_id)
```

> **핵심 [확인]**: CRDTOperation의 `counter`(Lamport)는 서버에선 단지 전달용 데이터. **충돌 해결은 100% 클라이언트(crdt.js)** 책임. 서버는 "똑똑한 메시지 버스"일 뿐. 이 설계가 README 2.3절 "CRDT는 클라이언트에서"와 일치.

### 3-4. Yjs 대안 (표준 접근, 더 추천)

**(a) 서버 비교 — 50줄 vs 367줄** [확인]:

| 항목 | 02 자체 서버(Python) | 03 Yjs 서버(Node.js) |
|---|---|---|
| LOC | 367줄 | **50줄** |
| 의존성 | fastapi, uvicorn | ws, y-websocket |
| 충돌해결 | 없음(클라가 함) | **y-websocket이 자동** |
| 핵심 코드 | 세션/브로드캐스트/히스토리 수작업 | `setupWSConnection(conn, req, {gc:true})` 한 줄 |
| 히스토리/머지 | 2000개 수동 유지 | Yjs 문서 상태가 자동 보관 |

03 서버 전체 동기화 로직이 사실상 이 한 줄로 끝남 [확인]:
```javascript
wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req, { gc: true })   // ← Yjs 표준이 전부 처리
})
```

**(b) 클라이언트 yjs-bridge.ts** [확인]: 편집 op를 `Y.Array<Y.Map>`에 push, `observe`로 원격 op 수신. 자기 변경 제외는 **transaction origin**(`this.ydoc.transact(fn, this)` + `event.transaction.origin === this`)과 **siteId 스킵** 이중 방어:

```typescript
this.yops.observe((event) => {
  if (event.transaction.origin === this) return;  // 내 트랜잭션 무시
  this.handleRemoteOperations(event);
});
// 적용 시에도 한번 더: if (opSiteId === this.siteId) continue;
```

참여자 표시는 Yjs **awareness** 사용(`setLocalStateField('user', {...})`) → 별도 커서 프로토콜 불필요.

**(c) 왜 자체구현을 쓰다 Yjs로?** README 6.4 [확인]: rHWP가 자체 IR(중간표현)을 가져 Yjs Y.Doc과 임피던스 불일치 → 변환 비용으로 Yjs 인코딩 이점 상쇄. 그래서 학습/신규는 Yjs, 운영은 (당시) 자체. 단, editor.js v4가 이미 Yjs로 이동 중이라 **현행은 Yjs 쪽으로 기운 상태** **[추측]**.

### 3-5. 한글 트랙 핵심 파일 표

| 파일 | 역할 | 핵심 함수/요소 |
|---|---|---|
| `01/iframe-collab-bridge.ts` | iframe↔부모 op 브릿지 | `broadcastEdit`, `applyRemoteEdit`, `isApplyingRemote` |
| `01/collaboration.ts` | WS 직접연결 세션관리(구) | `connect`, `broadcastOperation`, `scheduleReconnect`(3s) |
| `01/yjs-bridge.ts` | Yjs 통합(현행) | `connect`, `yops.observe`, transaction origin |
| `01/event-bus.ts` | 내부 pub/sub | `on`/`emit` (Map<string,Set>) |
| `02/server.py` | 메시지버스+시퀀스 | `websocket_endpoint`, `broadcast_to_session`, `parse_operation` |
| `03/server.js` | Yjs 표준 서버 | `setupWSConnection` |
| `04/js/crdt.js` | 자체 문자 CRDT | `compareIds`, `findInsertIndex`, `applyRemote`, `DocumentCRDT` |
| `04/js/editor.js` | iframe 호스팅+WS+RPC | `callRhwp`(RPC), `setupFullDocSync`(3초 폴링) |
| `04/js/files.js` | 파일클릭 후킹(NC30+) | `click` 캡처 인터셉터, `getFileId` |
| `04/js/viewer.js` | 파일액션 등록(구 API) | `OCA.Files.fileActions.registerAction` |
| `04/lib/.../EditorController.php` | 라우트/다운로드/저장 | `index`, `download`, `save`, `publicPage` |
| `04/templates/editor.php` | iframe 호스팅 HTML | data-* 속성으로 JS에 값 전달 |

**(보조) editor.js의 RPC 패턴** [확인] — 부모가 iframe 내부 메서드를 호출하는 방식:
```javascript
function callRhwp(method, params) {           // method: 'ready','loadFile','yjsConnect','exportFile'...
  iframe.contentWindow.postMessage({ type: 'rhwp-request', id, method, params }, '*');
  // iframe이 { type:'rhwp-response', id, result/error } 로 회신 → Promise resolve
}
```

**(보조) files.js — Nextcloud 30 Vue 호환 트릭** [확인]: 새 Vue Files 앱이 PHP 액션을 무시하므로, `document.addEventListener('click', ..., true)` **캡처 단계 인터셉터**로 HWP 클릭을 가로채 rHWP 에디터 페이지로 라우팅. `data-cy-files-list-row-fileid` 등 DOM 속성에서 fileId 추출.

---

## 4. 엑셀(OnlyOffice) 동시편집 트랙

### 4-1. 데이터 흐름 + JWT 인증

```
[브라우저] ──api.js iframe 로드──▶ [OnlyOffice DocServer]
   │  (token.enable.browser=false → api.js 접근엔 JWT 불필요)
   │
   ▼ 편집 시작
[DocServer] ──콜백(download)──▶ [Nextcloud CallbackController.download]
   │   "파일 내용 줘"             ↑ hash($doc)로 검증 (+JWT 있으면 추가검증)
   │
   ▼ 주기적/종료시
[DocServer] ──콜백(track,status=2/6)──▶ [CallbackController.track]
                "저장해" (편집결과 url)   ↓ url에서 받아 file->putContent
                                       [Nextcloud 파일 저장 + 버전관리]
```

**JWT 방향별 설정 [확인]** (`onlyoffice-local.json` + compose):

| 설정 | 값 | 의미 |
|---|---|---|
| `token.enable.browser` | `false` | 브라우저의 api.js 접근에 JWT 불요 |
| `token.enable.request.inbox` | `true` | DocServer로 **들어오는** 요청은 JWT 검증 |
| `token.enable.request.outbox` | `false`* | DocServer가 **나가는** 요청에 JWT 미첨부 (8.x 특성) |
| secret (inbox/outbox/session) | `JB_OnlyOffice_JWT_Secret_2026!` | HS256 서명 키 (하드코딩 ⚠️) |
| `storage.fs.secretString` | `verysecretstring` | nginx `secure_link`와 일치해야 캐시 다운로드 가능 |

> *`onlyoffice-local.json` 파일 자체는 outbox `true`로 적혀 있으나, **compose의 entrypoint가 런타임에 `outbox:false`로 덮어씀** [확인: docker-compose.nextcloud.yml:96 인라인 python]. 즉 **최종 유효값은 outbox=false**. 위키/README도 false로 설명. 파일과 런타임이 불일치하는 함정.

JWT 시크릿은 양쪽에 동일하게 박혀야 함 [확인]: compose 환경변수 `JWT_SECRET`, local.json `secret`, Nextcloud `occ config:app:set onlyoffice jwt_secret` 3곳.

### 4-2. CallbackController.php.patched 패치 분석

**무엇을 패치했나** [확인]: OnlyOffice 8.x DocumentServer가 **파일 다운로드/트랙 콜백에 JWT 헤더를 붙이지 않는** 동작 변화에 대응. 원본 앱은 "JWT 헤더 없으면 무조건 거부"인데, 패치는 **"JWT 없어도 서명된 hash(`$doc`)가 유효하면 통과"**로 완화.

**(a) download() — JWT를 옵션으로** [확인] (line 239-252):
```php
if (!empty($this->config->getDocumentServerSecret())) {
    $header = ...->getHeader($this->config->jwtHeader());
    if (!empty($header)) {
        // JWT 있으면 검증 (실패해도 경고만 찍고 진행)
    } else {
        $this->logger->debug("Download without jwt header - hash is valid, proceeding");
        // ← 패치 핵심: JWT 없어도 통과
    }
}
```
패치 전(원본): `else` 분기에서 `STATUS_FORBIDDEN` 반환 → 다운로드 실패("다운로드하지 못했습니다"). **패치 후: hash 검증(`crypt->readHash`, line 219)을 신뢰하고 진행.**

**(b) track() — 동일 완화** [확인] (line 451-456): 저장 콜백에서도 JWT 헤더 없으면 `"Track without jwt header - hash is valid, proceeding"` 로그 후 원본 파라미터로 진행.

**(c) emptyfile()은 패치 안 됨 — JWT 필수 유지** [확인] (line 373-388): 빈 문서 생성 경로는 여전히 JWT 없으면 `FORBIDDEN`. 즉 **선택적 완화**(download/track만), 보안을 전면 무력화한 건 아님.

**diff 요약**:
| 메서드 | 원본 동작 | 패치 후 동작 |
|---|---|---|
| download | JWT 헤더 없으면 403 | hash 유효하면 통과(JWT 옵션) |
| track | JWT 헤더 없으면 403 | hash 유효하면 통과(JWT 옵션) |
| emptyfile | JWT 필수 | **변경 없음(JWT 필수)** |

> ⚠️ 위키 경고 [확인]: 이 패치는 OnlyOffice **앱 업데이트 시 덮어써짐** → 업데이트마다 재패치 필요. (운영 부채)

### 4-3. SSO 통합

**OWI(Open WebUI) 로그인 → Nextcloud 자동 로그인** 브릿지 [확인] (`nextcloud-sso/`):

```
[OWI 로그인, token 쿠키]
   │
   ▼ nginx auth_request → /auth
[auth.py: jwt.decode(token, WEBUI_SECRET_KEY)]
   │  email 없으면 OWI API(/api/v1/auths/)로 조회
   ▼ 성공 시
[X-Auth-User: email 헤더 반환 (200)]   →  nginx가 Nextcloud로 통과
```

**앱 비밀번호 생성** [확인] (`app.py`): 사용자마다 결정론적 비번 생성 후 Basic Auth로 Nextcloud 로그인:
```python
password = f"NC_{hashlib.md5(email.encode()).hexdigest()[:12]}!Aa"   # ⚠️ md5 결정론
credentials = base64.b64encode(f"{email}:{password}".encode()).decode()
resp.headers['X-Auth-Credentials'] = f"Basic {credentials}"
```

**사용자 프로비저닝** [확인] (`sync_users.py`): OWI DB(`user` 테이블)를 매시간 크론으로 읽어 Nextcloud에 없는 사용자를 `occ user:add`로 생성(랜덤 비번, SSO만 쓰므로 미사용). README 기준 9141+ 사용자 자동 프로비저닝.

### 4-4. 엑셀 트랙 핵심 파일 표

| 파일 | 역할 | 핵심 |
|---|---|---|
| `05/CallbackController.php.patched` | DocServer 콜백 처리 | `download`/`track` JWT 우회, `emptyfile` 유지 |
| `05/onlyoffice-local.json` | DocServer JWT/시크릿 | token.enable, secret, secretString |
| `05/docker-compose.nextcloud.yml` | 전체 스택 | nextcloud30 + onlyoffice8.1 + sso + db/redis. entrypoint가 local.json 런타임 패치 |
| `05/onlyoffice-entrypoint.sh` | 권한/캐시 수정 | App_Data chmod 777, secure_link 세팅 |
| `05/nextcloud-sso/auth.py` | OWI JWT 검증(nginx auth) | `jwt.decode`, X-Auth-User |
| `05/nextcloud-sso/app.py` | 자동 로그인 + 앱비번 | md5 기반 password, Basic Auth |
| `05/nextcloud-sso/sync_users.py` | 사용자 동기화 크론 | OWI DB → `occ user:add` |
| `05/sync-owi-to-nextcloud.sh` | 동기화 래퍼 | (셸 진입점) |

---

## 5. 두 트랙 통합 패턴 비교

### 5.1 공통점 / 차이점 표

| 측면 | Track A: 한글(rHWP) | Track B: 엑셀(OnlyOffice) |
|---|---|---|
| **편집 엔진** | 자체 제작 (Rust→WASM) | 외부 솔루션 (OnlyOffice 8.1) |
| **격리 방식** | iframe + postMessage ✅ | iframe + api.js ✅ (공통) |
| **호스트** | Nextcloud rhwp_connector | Nextcloud onlyoffice 앱 (공통) |
| **실시간 채널** | WebSocket (자체 8765 / Yjs 1234) | OnlyOffice 내부 CoAuthoring |
| **충돌 해결** | 클라이언트 CRDT(Lamport/Yjs) | OnlyOffice 내장(블랙박스) |
| **인증** | **사실상 없음** (WS 무인증) ⚠️ | JWT(HS256) + hash 서명 |
| **저장** | 브라우저가 export→`save` POST | DocServer가 track 콜백으로 putContent |
| **성숙도** | 자체구현, 진화중(v3→v4) | 프로덕션 검증된 표준 |
| **개발 비용** | 높음(CRDT 직접) | 낮음(통합만) |

**공통 통합 패턴 (★발표 핵심)**:
> **iframe 격리 + postMessage 통신 + WebSocket 실시간 + Nextcloud 호스팅** — 두 트랙 모두 동일. 한글 트랙은 이 패턴을 OnlyOffice에서 **벤치마킹**해 만든 것(README 2.1: "OnlyOffice의 JWT 검증/콜백/iframe 통합 패턴이 rHWP 구현에 직접 적용").

### 5.2 iframe 통신 패턴 (postMessage 형식 비교)

| 세대/경로 | 메시지 type | 방향 | 용도 |
|---|---|---|---|
| iframe-collab-bridge(직접 op) | `rhwp-edit` / `rhwp-cursor` / `rhwp-selection` | iframe→부모 | 로컬 편집/커서 전파 |
| | `rhwp-enable-collab` / `rhwp-apply-edit` / `rhwp-request-cursor` | 부모→iframe | 협업 활성화/원격 적용 |
| editor.js v4(RPC) | `rhwp-request` {id, method, params} | 부모→iframe | 메서드 호출(loadFile/exportFile/yjsConnect…) |
| | `rhwp-response` {id, result/error} | iframe→부모 | RPC 응답 |
| | `rhwp-yjs-status/synced/users/remote-applied` | iframe→부모 | Yjs 상태 알림 |

> ⚠️ 모든 postMessage가 `targetOrigin: '*'` 사용 [확인] — origin 검증 없음(6장).

### 5.3 인증·세션 관리 방식 비교

| | 한글 트랙 | 엑셀 트랙 |
|---|---|---|
| 사용자 식별 | `OC.currentUser`(없으면 `user-랜덤`) | Nextcloud 세션 + JWT users[] |
| 세션 키 | `collabId = 'hwp-' + md5(파일명)` [확인 EditorController:62] | DocServer document key |
| 무결성 | 없음 | hash($doc) + JWT(HS256) |
| 재연결 | 3초 재시도 + `since_seq` REST 동기화 | OnlyOffice 자체 |

> ⚠️ **세션 키 충돌 위험 [확인]**: collabId가 **파일명 md5**라서, 다른 폴더의 동명 파일이 **같은 협업 방에 묶임**(EditorController.php:61 주석도 "임시 - 같은 이름 파일은 같은 방"이라 자인). fileId 기반이 아님.

---

## 6. 운영 주의사항 / 알려진 제약

**보안 (README 7장 + 코드 확인)**:
1. **하드코딩 시크릿 다수** [확인]: `JB_OnlyOffice_JWT_Secret_2026!`(JWT), `verysecretstring`(secure_link), `Nextcloud_Secure_2026!`(DB), `Redis_NC_2026!`, `JB_Admin_2026!`(admin), `Goo8LIEmvdkkkOHO`(WEBUI_SECRET_KEY), OWI DB 비번까지 평문 노출. **운영 적용 전 전량 교체 필수.**
2. **한글 협업 서버 무인증** [확인]: `allow_origins=["*"]` + WS에 토큰 검증 없음(server.py:24). 누구나 파일 세션 접속 가능 → 학습용 한정. Nextcloud 세션 토큰 검증 추가 권장.
3. **postMessage origin 미검증** [확인]: 송신 `'*'`, 수신 `event.origin` 체크 없음 → 악성 부모/자식 프레임 주입 가능.
4. **SSO 앱 비밀번호가 md5 결정론** [확인]: `NC_{md5(email)[:12]}!Aa` — 이메일만 알면 비번 산출 가능. 취약.
5. **OnlyOffice JWT 우회 패치** [확인]: hash만으로 다운로드/저장 허용. hash 서명키가 곧 방어선.

**빌드/배포**:
6. **rHWP Studio 빌드 산출물 미포함** [확인]: 01은 TypeScript 소스만. `npm run build`로 WASM(3.4MB)+JS(778KB) 생성해 정적 호스팅 필요. **→ 본 분석은 소스 정독 기반이며, 실제 런타임 동작은 [미확인](빌드/실행 환경 없음).**
7. **OnlyOffice 패치 휘발성** [확인]: 앱 업데이트 시 CallbackController 덮어써짐 → 재패치 필요.
8. **nginx `/cache/` 프록시 누락 시** "다운로드하지 못했습니다" 에러 [확인 위키].

**아키텍처 부채**:
9. **이중 동기화 경로** [확인]: Yjs op 동기화 + 3초 full_sync 폴링이 병행. full_sync는 base64 전체문서 브로드캐스트라 문서 커질수록 대역폭 부담. op 매핑이 안정화되면 제거 대상.
10. **세션 키가 파일명 md5** [확인]: 동명 파일 충돌(5.3).
11. **두 세대 코드 공존**: iframe-collab-bridge(직접 op) vs editor.js(RPC+Yjs), crdt.js(자체) vs yjs-bridge(Yjs). 발표 시 "어느 게 현행인가" 혼동 주의 → **현행 = editor.js v4 + Yjs**.

---

## 7. PPT 강조 슬라이드 후보

**① "두 트랙, 하나의 패턴" 다이어그램** (2.1 시스템 전체도)
- 한글=자체CRDT / 엑셀=OnlyOffice, 그러나 둘 다 `iframe + postMessage + WebSocket + Nextcloud`. 통합 철학의 일관성을 한 장에.

**② "서버는 멍청하게, 클라가 똑똑하게" — CRDT 책임 분리**
- server.py가 충돌해결을 안 한다는 반전. `compareIds`(counter→siteId) 7줄 스니펫 + "네트워크 순서 뒤섞여도 모두 같은 문서로 수렴" 메시지.

**③ Lamport CRDT 수렴 애니메이션** (3-3)
- 사용자 A "가", B "나"를 같은 위치에 동시 입력 → counter 같으면 siteId 사전순 → 양쪽 모두 "가나"(또는 "나가")로 **동일 수렴**. 화이트보드 시연 효과 최고.

**④ "50줄 vs 367줄" — Yjs의 위력** (3-4)
- 자체 서버 367줄 ↔ Yjs 서버 `setupWSConnection` 한 줄. "표준 CRDT 라이브러리를 쓰면 이만큼 줄어든다"는 설득력. 협력자의 Yjs 추천 근거.

**⑤ OnlyOffice JWT 우회 패치 Before/After** (4-2)
- "JWT 헤더 없으면 403 → hash 유효하면 통과" 3줄 diff. 외부 솔루션 통합 시 마주치는 현실적 호환성 문제 + 해결의 사례로 임팩트.

---

### 부록: 분석 커버리지

- **정독 완료 [확인]**: README, 위키3, 01 전체(5파일), 02 server.py+compose, 03 server.js, 04 crdt/editor/files/viewer.js + EditorController.php + editor.php, 05 CallbackController.patched + local.json + compose + auth.py/app.py/sync_users.py
- **미정독(보조, 보고서 영향 경미)**: 04 routes.php / Application.php / Listener·Settings PHP / css, 05 entrypoint.sh·sync 셸·Dockerfile (역할은 README/compose로 확인됨)
- **실행 검증 [미확인]**: rHWP Studio 빌드 산출물 부재로 런타임 동작은 코드 정독 기반 추론
