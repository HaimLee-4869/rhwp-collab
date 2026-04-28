/**
 * rHWP Connector - Nextcloud 30+ File Click Interceptor
 * Vue Files 앱에서 HWP 파일 클릭 인터셉트
 */
(function() {
    'use strict';

    const HWP_EXTENSIONS = ['.hwp', '.hwpx'];

    function isHwpFile(filename) {
        if (!filename) return false;
        const lower = filename.toLowerCase();
        return HWP_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    function getFileId(element) {
        // Nextcloud 30 Vue Files app data attributes
        let el = element;
        while (el && el !== document.body) {
            // data-cy-files-list-row-fileid (Nextcloud 30+)
            const fileId = el.getAttribute('data-cy-files-list-row-fileid') ||
                          el.getAttribute('data-fileid') ||
                          el.getAttribute('data-id') ||
                          el.dataset?.fileid ||
                          el.dataset?.id;
            if (fileId) return fileId;
            el = el.parentElement;
        }
        return null;
    }

    function getFileName(element) {
        // 파일명 찾기
        let el = element;
        while (el && el !== document.body) {
            // data-cy-files-list-row-name
            const name = el.getAttribute('data-cy-files-list-row-name') ||
                        el.getAttribute('data-file') ||
                        el.dataset?.file;
            if (name) return name;

            // .files-list__row-name-text 또는 유사 클래스
            const nameEl = el.querySelector('.files-list__row-name-text, .innernametext, .nametext');
            if (nameEl) return nameEl.textContent?.trim();

            el = el.parentElement;
        }
        return null;
    }

    function openInRhwp(fileId) {
        // OC.generateUrl 사용하거나 webroot 감지
        const webroot = typeof OC !== 'undefined' && OC.webroot ? OC.webroot : '/nextcloud';
        const url = webroot + '/apps/rhwp_connector/' + fileId;
        window.location.href = url;
    }

    // 클릭 이벤트 인터셉트 (캡처 단계)
    document.addEventListener('click', function(e) {
        const target = e.target;

        // Files 앱 내부인지 확인
        if (!window.location.pathname.includes('/apps/files')) {
            return;
        }

        const fileName = getFileName(target);
        if (!fileName || !isHwpFile(fileName)) {
            return;
        }

        const fileId = getFileId(target);
        if (!fileId) {
            console.log('[rHWP] HWP 파일 감지했으나 fileId 없음:', fileName);
            return;
        }

        console.log('[rHWP] HWP 파일 클릭 인터셉트:', fileName, fileId);
        e.preventDefault();
        e.stopPropagation();
        openInRhwp(fileId);
    }, true);  // 캡처 단계에서 실행

    // 더블클릭도 인터셉트
    document.addEventListener('dblclick', function(e) {
        const target = e.target;

        if (!window.location.pathname.includes('/apps/files')) {
            return;
        }

        const fileName = getFileName(target);
        if (!fileName || !isHwpFile(fileName)) {
            return;
        }

        const fileId = getFileId(target);
        if (fileId) {
            console.log('[rHWP] HWP 더블클릭 인터셉트:', fileName, fileId);
            e.preventDefault();
            e.stopPropagation();
            openInRhwp(fileId);
        }
    }, true);

    // Nextcloud 30 FileAction API 시도 (있으면)
    function tryRegisterFileAction() {
        if (typeof NextcloudFiles !== 'undefined' && NextcloudFiles.registerFileAction) {
            try {
                const action = new NextcloudFiles.FileAction({
                    id: 'open-in-rhwp',
                    displayName: () => 'rHWP로 열기',
                    iconSvgInline: () => '<svg viewBox="0 0 24 24"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg>',
                    order: -100,
                    enabled: (nodes) => {
                        if (nodes.length !== 1) return false;
                        const name = (nodes[0].basename || '').toLowerCase();
                        return name.endsWith('.hwp') || name.endsWith('.hwpx');
                    },
                    exec: async (node) => {
                        openInRhwp(node.fileid);
                        return null;
                    },
                    default: NextcloudFiles.Permission.READ
                });
                NextcloudFiles.registerFileAction(action);
                console.log('[rHWP] FileAction API 등록 성공');
            } catch (e) {
                console.log('[rHWP] FileAction API 등록 실패, 클릭 인터셉터 사용:', e.message);
            }
        }
    }

    // DOM ready 후 시도
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryRegisterFileAction);
    } else {
        setTimeout(tryRegisterFileAction, 1000);
    }

    console.log('[rHWP] 파일 클릭 인터셉터 활성화 (Nextcloud 30+)');
})();
