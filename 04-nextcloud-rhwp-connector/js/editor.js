/**
 * rHWP Editor - Nextcloud Integration with Yjs CRDT
 * v4.0 - Yjs 기반 (rHWP Studio가 직접 Y.Array로 operation 동기화)
 */
(function() {
    'use strict';

    const YJS_SERVER = 'wss://ai.jb.go.kr/rhwp-yjs';

    async function init() {
        const container = document.getElementById('rhwp-container');
        if (!container) {
            console.error('[rHWP] Container not found');
            return;
        }

        const iframe = document.getElementById('rhwp-editor');
        const loading = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');
        const saveBtn = document.getElementById('save-btn');
        const closeBtn = document.getElementById('close-btn');
        const toolbar = document.getElementById('toolbar');
        const status = document.getElementById('status');

        const downloadUrl = container.dataset.downloadUrl;
        const saveUrl = container.dataset.saveUrl;
        const fileName = container.dataset.fileName;
        const rhwpUrl = container.dataset.rhwpUrl;
        const fileId = container.dataset.fileId;
        const collabId = container.dataset.collabId || ('hwp-' + fileId);

        console.log('[rHWP v4.0 Yjs] 시작:', fileName, 'collabId:', collabId);

        // Yjs 이벤트 수신 (rHWP iframe이 부모로 전달)
        window.addEventListener('message', function(e) {
            if (!e.data || typeof e.data !== 'object') return;
            switch (e.data.type) {
                case 'rhwp-yjs-status':
                    console.log('[Yjs] 연결 상태:', e.data.status);
                    if (e.data.status === 'connected') {
                        showStatus('실시간 동시편집 연결됨', 'success');
                    }
                    break;
                case 'rhwp-yjs-synced':
                    console.log('[Yjs] 동기화 완료');
                    break;
                case 'rhwp-yjs-users':
                    updateUserList(e.data.users || []);
                    break;
                case 'rhwp-yjs-remote-applied':
                    showStatus('변경사항 수신', 'success');
                    break;
            }
        });

        // iframe 로드 (nginx no-cache 헤더에 의존 → 브라우저가 ETag로 검증)
        iframe.src = rhwpUrl;
        await new Promise((resolve) => {
            iframe.onload = resolve;
            setTimeout(resolve, 5000);
        });

        if (loadingText) loadingText.textContent = 'rHWP 초기화 중...';

        // rHWP ready 대기 (최대 60초 - WASM 3.4MB + JS 778KB 다운로드 고려)
        let ready = false;
        let lastError = null;
        for (let i = 0; i < 120 && !ready; i++) {
            await new Promise(r => setTimeout(r, 500));
            try {
                ready = await callRhwp('ready');
                if (i % 10 === 0) console.log('[rHWP] ready 체크 ' + i + '/120:', ready);
                // 진행 상황 UI 업데이트
                if (loadingText && i % 4 === 0) {
                    const sec = Math.floor(i / 2);
                    loadingText.textContent = 'rHWP 초기화 중... (' + sec + 's)';
                }
            } catch (e) {
                lastError = e.message || e;
                if (i % 10 === 0) console.log('[rHWP] ready 에러:', lastError);
            }
        }
        if (!ready) {
            const errMsg = lastError ? ('rHWP 초기화 실패: ' + lastError) : 'rHWP 초기화 실패 (60초 타임아웃)';
            console.error('[rHWP]', errMsg);
            if (loadingText) loadingText.innerHTML = '<span style="color:var(--color-error)">' + errMsg + '</span>';
            return;
        }
        console.log('[rHWP] WASM 초기화 완료');

        // 파일 다운로드
        if (loadingText) loadingText.textContent = '파일 다운로드 중...';
        let response;
        try {
            response = await fetch(downloadUrl, { credentials: 'include' });
        } catch (e) {
            if (loadingText) loadingText.innerHTML = '<span style="color:var(--color-error)">다운로드 실패: ' + e.message + '</span>';
            return;
        }
        if (!response.ok) {
            if (loadingText) loadingText.innerHTML = '<span style="color:var(--color-error)">다운로드 실패: HTTP ' + response.status + '</span>';
            return;
        }

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        console.log('[rHWP] 파일 크기:', bytes.length, 'bytes');

        // 문서 로드
        if (loadingText) loadingText.textContent = '문서 렌더링 중...';
        try {
            await callRhwp('loadFile', { data: Array.from(bytes), fileName: fileName });
        } catch (e) {
            if (loadingText) loadingText.innerHTML = '<span style="color:var(--color-error)">문서 로드 실패: ' + e.message + '</span>';
            return;
        }

        // Yjs 연결
        if (loadingText) loadingText.textContent = '동시편집 연결 중...';
        const userInfo = getUserInfo();
        console.log('[Yjs] 연결 요청:', { serverUrl: YJS_SERVER, docName: collabId, userId: userInfo.id });
        try {
            const connectResult = await callRhwp('yjsConnect', {
                serverUrl: YJS_SERVER,
                docName: collabId,
                userId: userInfo.id,
                userName: userInfo.name
            });
            console.log('[Yjs] 연결 요청 응답:', connectResult);
        } catch (e) {
            console.error('[Yjs] 연결 실패:', e.message || e);
            showStatus('동시편집 연결 실패: ' + (e.message || e), 'error');
        }

        // UI 표시
        if (loading) {
            loading.style.display = 'none';
            loading.classList.add('hidden');
        }
        if (saveBtn) saveBtn.disabled = false;

        // ═══ 보완: rhwp-collab 서버로 3초 주기 전체 문서 동기화 ═══
        // Yjs operation 매핑이 불완전한 경우에 대비한 safety net
        setupFullDocSync(userInfo, collabId);

        // 저장 버튼
        if (saveBtn && saveUrl) {
            saveBtn.addEventListener('click', saveDocument);
        }
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (saveBtn && !saveBtn.disabled) saveBtn.click();
            }
        });

        // 닫기 버튼
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                // Yjs 연결 정리
                callRhwp('yjsDisconnect').catch(() => {});
                const webroot = typeof OC !== 'undefined' && OC.webroot ? OC.webroot : '/nextcloud';
                window.location.href = webroot + '/apps/files';
            });
        }

        async function saveDocument() {
            try {
                saveBtn.disabled = true;
                showStatus('저장 중...', 'saving');
                const result = await callRhwp('exportFile');
                if (!result || !result.data) throw new Error('문서 데이터 없음');
                const resp = await fetch(saveUrl, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: result.data })
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                showStatus('저장 완료', 'success');
            } catch (e) {
                console.error('[rHWP] 저장 실패:', e);
                showStatus('저장 실패: ' + e.message, 'error');
            } finally {
                saveBtn.disabled = false;
            }
        }
    }

    // ═══ 전체 문서 동기화 (rhwp-collab WebSocket 병행) ═══
    const COLLAB_WS = 'wss://ai.jb.go.kr/rhwp-collab/ws';
    let collabWs = null;
    let lastDocHash = 0;
    let lastLocalEditTime = 0;

    function simpleHash(bytes) {
        let h = 0;
        for (let i = 0; i < Math.min(bytes.length, 2000); i++) {
            h = ((h << 5) - h) + (bytes[i] || 0);
            h |= 0;
        }
        h = (h * 31 + bytes.length) | 0;
        return h;
    }

    function setupFullDocSync(userInfo, collabId) {
        try {
            collabWs = new WebSocket(COLLAB_WS + '/' + collabId);
            collabWs.onopen = function() {
                console.log('[FullSync] 연결됨');
                collabWs.send(JSON.stringify({
                    type: 'join',
                    userId: userInfo.id,
                    userName: userInfo.name,
                    crdtSiteId: userInfo.id + '-' + Date.now()
                }));
            };
            collabWs.onmessage = async function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'full_sync' && data.userId !== userInfo.id) {
                        // 최근 2초 내 내가 편집한 경우 무시
                        if (Date.now() - lastLocalEditTime < 2000) {
                            console.log('[FullSync] 편집 중 - 수신 지연');
                            return;
                        }
                        console.log('[FullSync] 원격 문서 수신:', data.userName);
                        const binary = atob(data.document);
                        const remoteBytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) remoteBytes[i] = binary.charCodeAt(i);
                        // rHWP에 다시 로드
                        await callRhwp('loadFile', {
                            data: Array.from(remoteBytes),
                            fileName: document.getElementById('rhwp-container').dataset.fileName
                        });
                        lastDocHash = simpleHash(remoteBytes);
                    }
                } catch (e) { console.error('[FullSync] 메시지 처리 에러:', e); }
            };
            collabWs.onerror = (e) => console.warn('[FullSync] WS 에러:', e);
            collabWs.onclose = () => console.log('[FullSync] 연결 종료');
        } catch (e) {
            console.error('[FullSync] 연결 실패:', e);
            return;
        }

        // 키 입력 감지 → 로컬 편집 시간 기록
        try {
            const iframe = document.getElementById('rhwp-editor');
            const idoc = iframe.contentDocument || iframe.contentWindow.document;
            idoc.addEventListener('keydown', () => { lastLocalEditTime = Date.now(); }, true);
            idoc.addEventListener('input', () => { lastLocalEditTime = Date.now(); }, true);
        } catch (e) {
            console.warn('[FullSync] iframe 키 감지 실패 (동일 origin 아님?):', e);
        }

        // 3초마다 내 문서 export → hash 비교 → 변경됐으면 브로드캐스트
        setInterval(async () => {
            if (!collabWs || collabWs.readyState !== WebSocket.OPEN) return;
            try {
                const result = await callRhwp('exportFile');
                if (!result || !result.data) return;
                const bytes = new Uint8Array(result.data);
                const h = simpleHash(bytes);
                if (h !== lastDocHash) {
                    lastDocHash = h;
                    // Base64 인코딩 (청크 방식)
                    let binary = '';
                    const chunkSize = 8192;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                        binary += String.fromCharCode.apply(null, chunk);
                    }
                    const base64 = btoa(binary);
                    collabWs.send(JSON.stringify({
                        type: 'full_sync',
                        document: base64
                    }));
                    console.log('[FullSync] 문서 변경 감지 → 전송');
                }
            } catch (e) {}
        }, 3000);
    }

    // rHWP 메서드 호출 (postMessage)
    let msgId = 0;
    function callRhwp(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++msgId;
            const iframe = document.getElementById('rhwp-editor');
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Timeout: ' + method));
            }, 30000);

            function handler(e) {
                if (!e.data || e.data.type !== 'rhwp-response' || e.data.id !== id) return;
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                if (e.data.error) reject(new Error(e.data.error));
                else resolve(e.data.result);
            }
            window.addEventListener('message', handler);
            iframe.contentWindow.postMessage({ type: 'rhwp-request', id, method, params }, '*');
        });
    }

    function getUserInfo() {
        try {
            if (typeof OC !== 'undefined' && OC.currentUser) {
                return { id: OC.currentUser, name: OC.getCurrentUser().displayName || OC.currentUser };
            }
        } catch (e) {}
        return { id: 'user-' + Math.random().toString(36).slice(2, 10), name: '익명' };
    }

    function updateUserList(users) {
        let userListEl = document.getElementById('user-list');
        if (!userListEl) return;
        if (users.length <= 1) {
            userListEl.innerHTML = '';
            return;
        }
        userListEl.innerHTML = users.map(u => {
            const name = (u.name || u.id || '익명').split('@')[0];
            const color = u.color || '#888';
            return `<div class="user-badge" style="background:${color}" title="${u.name || u.id}">${name}</div>`;
        }).join('');
    }

    function showStatus(text, type) {
        const status = document.getElementById('status');
        if (!status) return;
        status.textContent = text;
        status.className = type || '';
        if (type === 'success') {
            setTimeout(() => { status.className = ''; status.textContent = ''; }, 2000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
