<?php
/** @var array $_ */
/** @var \OCP\IL10N $l */
script('rhwp_connector', 'crdt');
script('rhwp_connector', 'editor');
style('rhwp_connector', 'editor');
?>

<div id="app-content">
    <div id="rhwp-container"
         data-download-url="<?php p($_['downloadUrl']); ?>"
         data-save-url="<?php p($_['saveUrl']); ?>"
         data-rhwp-url="<?php p($_['rhwpUrl']); ?>"
         data-file-name="<?php p($_['fileName']); ?>"
         data-file-id="<?php p($_['fileId']); ?>"
         data-collab-id="<?php p($_['collabId'] ?? ''); ?>">

        <div id="loading">
            <div class="spinner"></div>
            <div id="loading-text">파일 로딩 중...</div>
        </div>

        <div id="toolbar">
            <button id="close-btn">닫기</button>
            <?php if (!empty($_['saveUrl'])): ?>
            <button id="save-btn" disabled>웹 저장</button>
            <?php endif; ?>
            <span id="file-name"><?php p($_['fileName']); ?></span>
            <div id="user-list"></div>
        </div>

        <div id="cursor-layer"></div>

        <iframe id="rhwp-editor"></iframe>

        <div id="status"></div>
    </div>
</div>
