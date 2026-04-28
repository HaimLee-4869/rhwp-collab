<?php
/** @var array $_ */
?>
<div id="rhwp-settings" class="section">
    <h2>rHWP 설정</h2>
    <p class="settings-hint">HWP 파일을 열 때 사용할 rHWP 에디터 URL을 설정합니다.</p>

    <div class="rhwp-setting">
        <label for="rhwp-url">rHWP 에디터 URL</label>
        <input type="text" id="rhwp-url" name="rhwp_url"
               value="<?php p($_['rhwp_url']); ?>"
               placeholder="https://ai.jb.go.kr/rhwp/"
               style="width: 400px;">
        <button id="rhwp-save" class="button">저장</button>
    </div>
</div>

<script>
document.getElementById('rhwp-save').addEventListener('click', function() {
    const url = document.getElementById('rhwp-url').value;
    fetch(OC.generateUrl('/apps/rhwp_connector/ajax/settings'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'requesttoken': OC.requestToken
        },
        body: JSON.stringify({ rhwp_url: url })
    }).then(r => r.json()).then(data => {
        OC.Notification.showTemporary('설정이 저장되었습니다.');
    }).catch(err => {
        OC.Notification.showTemporary('저장 실패: ' + err);
    });
});
</script>
