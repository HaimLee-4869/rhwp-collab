<?php
/**
 * rHWP Connector - Nextcloud App
 */

return [
    'routes' => [
        ['name' => 'editor#index', 'url' => '/{fileId}', 'verb' => 'GET'],
        ['name' => 'editor#download', 'url' => '/download/{fileId}', 'verb' => 'GET'],
        ['name' => 'editor#save', 'url' => '/save/{fileId}', 'verb' => 'POST'],
        ['name' => 'editor#publicPage', 'url' => '/s/{shareToken}', 'verb' => 'GET'],
    ],
];
