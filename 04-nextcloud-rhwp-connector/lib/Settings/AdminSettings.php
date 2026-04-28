<?php
declare(strict_types=1);

namespace OCA\RhwpConnector\Settings;

use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;

class AdminSettings implements ISettings {
    private IConfig $config;

    public function __construct(IConfig $config) {
        $this->config = $config;
    }

    public function getForm(): TemplateResponse {
        $params = [
            'rhwp_url' => $this->config->getAppValue('rhwp_connector', 'rhwp_url', 'https://ai.jb.go.kr/rhwp/'),
        ];
        return new TemplateResponse('rhwp_connector', 'settings-admin', $params, '');
    }

    public function getSection(): string {
        return 'rhwp_connector';
    }

    public function getPriority(): int {
        return 50;
    }
}
