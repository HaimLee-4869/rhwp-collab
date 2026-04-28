<?php
declare(strict_types=1);

namespace OCA\RhwpConnector\Listener;

use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

class BeforeTemplateListener implements IEventListener {
    public function handle(Event $event): void {
        if (!($event instanceof BeforeTemplateRenderedEvent)) {
            return;
        }
        
        // Files 앱 페이지에서만 로드
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        if (strpos($uri, '/apps/files') !== false) {
            Util::addScript('rhwp_connector', 'files');
        }
    }
}
