<?php
declare(strict_types=1);

namespace OCA\RhwpConnector\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Files 앱에서 HWP 파일 핸들러 스크립트 로드
 */
class LoadAdditionalScriptsListener implements IEventListener {
    public function handle(Event $event): void {
        if (!($event instanceof LoadAdditionalScriptsEvent)) {
            return;
        }

        // HWP 파일 열기 액션 등록 스크립트
        Util::addScript('rhwp_connector', 'files');
        Util::addScript('rhwp_connector', 'viewer');
        Util::addStyle('rhwp_connector', 'style');
    }
}
