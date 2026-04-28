/**
 * rHWP Connector - Nextcloud File Actions
 * HWP/HWPX 파일을 rHWP 에디터로 열기
 */
(function() {
    'use strict';

    const RHWP_URL = OC.generateUrl('/apps/rhwp_connector');

    // HWP/HWPX MIME 타입
    const HWP_MIMES = [
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/hwp',
        'application/x-hwpml',
        'application/vnd.hancom.hwpx'
    ];

    // 확장자로 HWP 파일 판별
    function isHwpFile(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        return ext === 'hwp' || ext === 'hwpx';
    }

    // rHWP 에디터로 열기
    function openInRhwp(fileId, filename, context) {
        const url = RHWP_URL + '/' + fileId;
        window.open(url, '_blank');
    }

    // File Actions 등록
    if (OCA.Files && OCA.Files.fileActions) {
        // HWP 파일 기본 동작으로 rHWP 열기 등록
        OCA.Files.fileActions.registerAction({
            name: 'openInRhwp',
            displayName: 'rHWP로 열기',
            mime: 'all',
            permissions: OC.PERMISSION_READ,
            iconClass: 'icon-edit',
            actionHandler: function(filename, context) {
                if (!isHwpFile(filename)) return;
                const fileId = context.fileInfoModel.get('id');
                openInRhwp(fileId, filename, context);
            },
            order: -50
        });

        // 확장자 기반 기본 동작 설정
        OCA.Files.fileActions.setDefault('hwp', 'openInRhwp');
        OCA.Files.fileActions.setDefault('hwpx', 'openInRhwp');
    }

    // Nextcloud Files 앱 v25+ (Vue 기반) 호환
    if (window.OCA?.Files?.registerFileAction) {
        // Modern Files app API
        OCA.Files.registerFileAction({
            id: 'rhwp-open',
            displayName: () => 'rHWP로 열기',
            iconSvgInline: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
            enabled: (nodes) => {
                if (nodes.length !== 1) return false;
                const node = nodes[0];
                return isHwpFile(node.basename);
            },
            exec: async (node) => {
                const url = RHWP_URL + '/' + node.fileid;
                window.open(url, '_blank');
                return true;
            },
            default: true,
            order: -50,
        });
    }

    console.log('[rHWP Connector] File actions registered');
})();
