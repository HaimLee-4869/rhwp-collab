# rHWP + NextCloud 동시편집 — 전북특별자치도 생성형 AI 시스템 캡스톤 (2026)

전북특별자치도청 생성형 AI 시스템 4대 신규 기능 중 **[기능 4: 한글/엑셀 동시편집]** 산출물.

도청은 웹에서 여러 명이 함께 문서를 편집하는 환경을 필요로 했으며, 공공문서 특성상 화면에서 깨지지 않는 정확한 렌더링이 중요했다. 엑셀은 검증된 오픈소스가 있었으나, 한글(HWP)은 상용화된 웹 동시편집 솔루션이 존재하지 않았다.

## 결과 요약

- ✅ **NextCloud 기반 한글·엑셀 2개 트랙 동시편집** 구현
- ✅ **rhwp 본가 10건 PR 제출 및 머지** — 메인테이너 "모범적" 평가
- ✅ **한글2024와 픽셀 단위 정합** + 회귀 방지 가드 테스트 도입
- ✅ **production 운영** — `ai.jb.go.kr/nextcloud/`

## 1. 시스템 구조

### 1.1 두 트랙

- **엑셀** — 검증된 오픈소스 **OnlyOffice**를 NextCloud에 통합하여 자동 저장
- **한글** — 클릭 시 본 팀이 구현한 **connector**가 rHWP 에디터를 iframe으로 띄우고 **편집 방**을 생성

### 1.2 한글 협업 플로우

사용자의 편집은 하나하나 **커맨드 객체로 직렬화**되어 공유 공간에 올라가며, 같은 방의 다른 사용자 화면에 실시간으로 브로드캐스트된다.

```
[사용자 A 편집]
    ↓
[rHWP Studio (iframe)]
    ↓ postMessage (iframe-collab-bridge.ts)
[connector — 편집 커맨드 직렬화]
    ↓ WebSocket
[Yjs (y-websocket) — 충돌 처리]
    ↓ broadcast
[같은 방의 모든 사용자 화면 실시간 갱신]
```

### 1.3 충돌 처리 — Yjs

실시간 동기화와 충돌 처리는 검증된 오픈소스 CRDT 라이브러리인 **Yjs (y-websocket)** 를 사용한다. 본 팀의 기여는 자체 CRDT 구현이 아니라:

- **한글 문서를 위한 협업 계층** (편집 커맨드 직렬화·방 관리 등) 설계·구현
- **렌더러 본가에 대한 코드 기여** (다음 섹션)

## 2. rhwp 본가 기여 (10 PRs Merged)

rhwp는 한글 문서를 브라우저에 그려주는 오픈소스 렌더러이다. 도청 공직기강 문서가 화면에서 많이 깨지던 문제를 **한글2024와 픽셀 단위로 정합**하여 해결하였고, 그 결과를 본가 저장소에 기여하였다.


### 머지된 PR 목록

| PR | Commit | 내용 | 영역 |
|----|--------|------|------|
| [#1020](https://github.com/edwardkim/rhwp/pull/1020) | `1588c1e1` | PUA U+F02B1~F02C4 사각 안 숫자 매핑 (closes #727) | 폰트 |
| [#1021](https://github.com/edwardkim/rhwp/pull/1021) | `7f879ab7` | 단일-run RIGHT + leader 인라인 탭 (Task #874) | 목차 |
| [#1026](https://github.com/edwardkim/rhwp/pull/1026) | `cb53dd94` | 좁은 구두점 (U+2018/2019/2027) native/WASM 동기화 | 텍스트 |
| [#1047](https://github.com/edwardkim/rhwp/pull/1047) | `d84e7f52` | CharShape `start_pos` UTF-16 stream offset (closes #915) | 파서 |
| [#1059](https://github.com/edwardkim/rhwp/pull/1059) | `9d006fd0` | U+00B7 비례폰트 `.notdef` 위장값 가드 | 폰트 metric |
| [#1088](https://github.com/edwardkim/rhwp/pull/1088) | `328bae5a` | 참고2 para-float 표 루프 vertical_offset 정렬 | 레이아웃 |
| [#1101](https://github.com/edwardkim/rhwp/pull/1101) | `2a0a980f`, `687fba81` | 글자겹침 `hp:compose` 파싱 + char_overlap 한컴2024 정합 | 렌더러 |
| [#1102](https://github.com/edwardkim/rhwp/pull/1102) | `e8b6ee4c` | 회전 90°/270° 그림 bbox swap (이중회전 방지) | 렌더러 |


→ 전체 머지 결과 확인: [edwardkim/rhwp — author:HaimLee-4869 is:merged](https://github.com/edwardkim/rhwp/pulls?q=author%3AHaimLee-4869+is%3Amerged)

### 회귀 방지 가드 테스트

공직기강 문서는 통과했으나 공개 샘플에서 회귀(이전에 고친 렌더링이 다른 수정으로 다시 깨지는 현상)가 발생하기도 하였다. 이에 깨졌던 문서를 렌더링한 결과 이미지를 **기준본**으로 저장해두고, 이후 렌더링 결과를 **픽셀 단위로 비교**하여 달라지면 실패하는 **비주얼 회귀 테스트(가드 테스트)** 를 추가하였다.

## 3. 시스템 분석 자료

본 시스템의 전체 분석(아키텍처·CRDT 동작·한글 IME 처리·NextCloud 통합) 자료:

- [`docs/collab-analysis.md`](docs/collab-analysis.md) — 동시편집 시스템 종합 분석

## 4. 레포 구조

```
rhwp-collab/
├── rhwp/                          ← rHWP 소스 (submodule, Rust)
├── 01-rhwp-studio/                ← 협업 브릿지 코드 (TypeScript)
│   ├── iframe-collab-bridge.ts       동시편집 postMessage 통신
│   ├── collaboration.ts              세션 관리
│   └── yjs-bridge.ts                 Yjs 통합
├── 02-rhwp-collab-server/         ← Python WebSocket 서버 (초기 Lamport 버전)
├── 03-rhwp-yjs-server/            ← Yjs (y-websocket) WebSocket 서버
├── 04-nextcloud-rhwp-connector/   ← NextCloud 앱 (편집 커맨드 직렬화·방 관리)
├── 05-nextcloud-onlyoffice/       ← 엑셀 트랙 (NextCloud + OnlyOffice 통합)
├── 06-wiki-docs/                  ← 운영 위키 문서
├── server/                        ← 초기 Node.js 프로토타입 (보존용)
├── docs/                          ← 분석 자료
│   ├── collab-analysis.md            동시편집 시스템 종합 분석
│   └── rhwp-pr-list.md               PR별 상세 설명
├── README.md                      ← 이 파일
└── README-infra.md                ← 인프라 아키텍처 문서
```

## 5. 빌드·실행

### 요구사항
- Rust 1.94+ (rustup)
- wasm-pack 0.14+
- Node.js 22+

### rhwp 빌드 & 스튜디오 실행
```bash
git submodule update --init --recursive

cd rhwp
wasm-pack build --target web --release    # 최초 약 20분

cd ../01-rhwp-studio
npm install
npx vite --host 0.0.0.0 --port 7700
```

브라우저에서 `http://localhost:7700` 접속.

### Yjs 동시편집 서버
```bash
cd 03-rhwp-yjs-server
docker-compose up
```

### NextCloud connector 설치
`04-nextcloud-rhwp-connector/`를 NextCloud `apps/` 디렉토리에 배치하고 관리자 설정에서 활성화.


## 6. 참고 자료

- [rhwp 본가 (edwardkim/rhwp)](https://github.com/edwardkim/rhwp)
- [본인 머지된 PR 목록](https://github.com/edwardkim/rhwp/pulls?q=author%3AHaimLee-4869+is%3Amerged)
- 도청 production: `https://ai.jb.go.kr/nextcloud/`
- [`README-infra.md`](README-infra.md) — 인프라 아키텍처 상세