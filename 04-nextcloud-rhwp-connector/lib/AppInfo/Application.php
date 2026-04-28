<?php
declare(strict_types=1);

namespace OCA\RhwpConnector\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\Util;

class Application extends App implements IBootstrap {
    public const APP_ID = 'rhwp_connector';

    public function __construct(array $urlParams = []) {
        parent::__construct(self::APP_ID, $urlParams);
    }

    public function register(IRegistrationContext $context): void {
        // Files 앱 스크립트 이벤트
        $context->registerEventListener(
            \OCA\Files\Event\LoadAdditionalScriptsEvent::class,
            \OCA\RhwpConnector\Listener\LoadAdditionalScriptsListener::class
        );
        
        // 모든 페이지 렌더링 이벤트
        $context->registerEventListener(
            BeforeTemplateRenderedEvent::class,
            \OCA\RhwpConnector\Listener\BeforeTemplateListener::class
        );
    }

    public function boot(IBootContext $context): void {
    }
}
