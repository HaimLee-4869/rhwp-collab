# rHWP + NextCloud 동시편집
 
전북특별자치도청 생성형 AI 시스템 고도화 캡스톤 과제의 일환으로, NextCloud에서 HWP/HWPX 파일을 여러 사용자가 동시에 편집할 수 있는 시스템 구축.
 
## 배경
 
- **현재 상황:** NextCloud + OnlyOffice 연동으로 xlsx/docx는 동시편집 가능하나, HWP/HWPX는 다운로드만 됨
- **목표:** rHWP(오픈소스 HWP 에디터) + NextCloud 연동 + 동시편집 레이어 구현
- **rHWP 버전:** v0.7.2 (동시편집은 v2.0 로드맵이므로 직접 구현 필요)

## 아키텍처
 
```
[NextCloud 앱 "rhwp"] → iframe → [rhwp-studio (우리 포크)]
                                         ↕ WebSocket
                                   [Node.js 서버]
                                         ↕ WebDAV
                                   [NextCloud 파일 저장소]
```
 
## 기술 스택
 
- **에디터 본체:** rHWP (Rust + WebAssembly) - [HaimLee-4869/rhwp](https://github.com/HaimLee-4869/rhwp) (fork)
- **동시편집 동기화:** 이벤트 스트리밍 기반 (rHWP의 `DocumentEvent` JSON 활용)
- **서버:** Node.js (Express + ws)
- **파일 저장:** NextCloud WebDAV
- **연결 앱:** NextCloud custom PHP app

## 환경 설정
 
### 요구사항
- Rust 1.94+ (rustup)
- wasm-pack 0.14+
- Node.js 22+
- wasm32-unknown-unknown 타겟
### 빌드 방법
 
```bash
# submodule 초기화 (처음 clone 시)
git submodule update --init --recursive
 
# WASM 빌드
cd rhwp
wasm-pack build --target web --release
 
# rhwp-studio 실행
cd rhwp-studio
npm install
npx vite --host 0.0.0.0 --port 7700
```
 
브라우저에서 `http://localhost:7700` 접속 (VS Code 포트 포워딩 사용).
 
## 진행 상황
 
### ✅ Phase B: 환경 구축 (완료)
- [x] B-1: Rust 설치 (1.94.1 stable)
- [x] B-2: wasm-pack 설치 (0.14.0)
- [x] B-3: rHWP 소스 포크 & WASM 빌드 (3.5MB optimized)
- [x] B-4: rhwp-studio Vite 서버 실행
- [x] B-5: 브라우저에서 에디터 렌더링 확인
- [x] 도청 HWPX 파일 렌더링 테스트 통과

### 🚧 Phase C: 동시편집 구현 (예정)
- [ ] C-1: rhwp-studio postMessage API 확장 (`applyRemoteEvent`, `exportHwp` 등)
- [ ] C-2: Node.js WebSocket 서버 구축
- [ ] C-3: 두 사용자 동시편집 테스트

### 🚧 Phase D: NextCloud 연동 (예정)
- [ ] D-1: NextCloud WebDAV로 HWP 파일 로드/저장
- [ ] D-2: NextCloud 커스텀 앱(PHP) 작성
- [ ] D-3: HWP 파일 클릭 → 에디터 라우팅

## 발견한 이슈
 
- 일부 페이지에서 문단 번호(`1.`, `2.`) 렌더링이 누락되는 경우 있음 → rHWP v0.7 조판 엔진 한계 (v1.0에서 개선 예정)

## 참고 자료
 
- [rHWP 본가 (edwardkim/rhwp)](https://github.com/edwardkim/rhwp)
- [OnlyOffice NextCloud 앱 (참고용)](https://github.com/ONLYOFFICE/onlyoffice-nextcloud)
- [NextCloud 개발 문서](https://docs.nextcloud.com/server/latest/developer_manual/)

## 팀
 
전북대학교 SW중심대학 캡스톤디자인 2026 - rHWP 담당