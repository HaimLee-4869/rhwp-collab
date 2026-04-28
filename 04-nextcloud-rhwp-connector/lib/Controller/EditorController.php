<?php
declare(strict_types=1);

namespace OCA\RhwpConnector\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\Files\IRootFolder;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Share\IManager as ShareManager;
use OC\Security\CSP\ContentSecurityPolicyNonceManager;

class EditorController extends Controller {
    private IRootFolder $rootFolder;
    private IConfig $config;
    private IURLGenerator $urlGenerator;
    private ShareManager $shareManager;
    private ?string $userId;
    private ContentSecurityPolicyNonceManager $nonceManager;

    public function __construct(
        string $appName,
        IRequest $request,
        IRootFolder $rootFolder,
        IConfig $config,
        IURLGenerator $urlGenerator,
        ShareManager $shareManager,
        ?string $userId,
        ContentSecurityPolicyNonceManager $nonceManager
    ) {
        parent::__construct($appName, $request);
        $this->rootFolder = $rootFolder;
        $this->config = $config;
        $this->urlGenerator = $urlGenerator;
        $this->shareManager = $shareManager;
        $this->userId = $userId;
        $this->nonceManager = $nonceManager;
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function index(int $fileId): TemplateResponse {
        $rhwpUrl = $this->config->getAppValue('rhwp_connector', 'rhwp_url', 'https://ai.jb.go.kr/rhwp/');

        $userFolder = $this->rootFolder->getUserFolder($this->userId);
        $files = $userFolder->getById($fileId);

        $fileName = 'document.hwp';
        $collabId = '';
        if (!empty($files)) {
            $file = $files[0];
            $fileName = $file->getName();
            // 협업 ID: 파일명만 사용 (임시 - 같은 이름 파일은 같은 방)
            $collabId = 'hwp-' . md5($fileName);
        }

        $baseUrl = $this->urlGenerator->getAbsoluteURL('/apps/rhwp_connector');
        $downloadUrl = $baseUrl . '/download/' . $fileId;
        $saveUrl = $baseUrl . '/save/' . $fileId;

        $response = new TemplateResponse('rhwp_connector', 'editor', [
            'fileName' => $fileName,
            'downloadUrl' => $downloadUrl,
            'saveUrl' => $saveUrl,
            'rhwpUrl' => $rhwpUrl,
            'fileId' => $fileId,
            'collabId' => $collabId,
        ]);

        $csp = new ContentSecurityPolicy();
        $csp->addAllowedFrameDomain('https://ai.jb.go.kr');
        $csp->addAllowedConnectDomain('https://ai.jb.go.kr');
        $csp->addAllowedConnectDomain('wss://ai.jb.go.kr');
        $response->setContentSecurityPolicy($csp);

        return $response;
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function download(int $fileId): Response {
        $userFolder = $this->rootFolder->getUserFolder($this->userId);
        $files = $userFolder->getById($fileId);

        if (empty($files)) {
            return new JSONResponse(['error' => 'File not found'], 404);
        }

        $file = $files[0];
        $content = $file->getContent();
        $fileName = $file->getName();

        $response = new DataDownloadResponse($content, $fileName, 'application/octet-stream');
        $response->addHeader('Access-Control-Allow-Origin', '*');
        $response->addHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return $response;
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function save(int $fileId): JSONResponse {
        $userFolder = $this->rootFolder->getUserFolder($this->userId);
        $files = $userFolder->getById($fileId);

        if (empty($files)) {
            return new JSONResponse(['error' => 'File not found'], 404);
        }

        $file = $files[0];

        $input = file_get_contents('php://input');
        $data = json_decode($input, true);

        if (!isset($data['data']) || !is_array($data['data'])) {
            return new JSONResponse(['error' => 'Invalid data'], 400);
        }

        $bytes = pack('C*', ...$data['data']);

        try {
            $file->putContent($bytes);
            return new JSONResponse(['success' => true, 'size' => strlen($bytes)]);
        } catch (\Exception $e) {
            return new JSONResponse(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * @PublicPage
     * @NoCSRFRequired
     */
    public function publicPage(string $shareToken): TemplateResponse {
        $rhwpUrl = $this->config->getAppValue('rhwp_connector', 'rhwp_url', 'https://ai.jb.go.kr/rhwp/');

        try {
            $share = $this->shareManager->getShareByToken($shareToken);
            $node = $share->getNode();
            $fileName = $node->getName();

            $baseUrl = $this->urlGenerator->getAbsoluteURL('/apps/rhwp_connector');
            $downloadUrl = $baseUrl . '/s/' . $shareToken . '/download';

            $response = new TemplateResponse('rhwp_connector', 'editor', [
                'fileName' => $fileName,
                'downloadUrl' => $downloadUrl,
                'saveUrl' => '',
                'rhwpUrl' => $rhwpUrl,
                'fileId' => 0,
                'isPublic' => true,
            ], 'public');

            $csp = new ContentSecurityPolicy();
            $csp->addAllowedFrameDomain('https://ai.jb.go.kr');
            $csp->addAllowedConnectDomain('https://ai.jb.go.kr');
            $response->setContentSecurityPolicy($csp);

            return $response;
        } catch (\Exception $e) {
            return new TemplateResponse('rhwp_connector', 'error', [
                'error' => $e->getMessage()
            ], 'guest');
        }
    }
}
