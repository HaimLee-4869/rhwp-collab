# Nextcloud + OnlyOffice

Excel 동시 편집을 지원하는 문서 협업 서비스.

## 서비스 위치

| 환경 | Nextcloud | OnlyOffice | Compose 파일 |
|------|-----------|------------|--------------|
| **프로덕션** (ai.jb.go.kr) | :8085 | :8087 | `/home/gil/prod-compose/docker-compose.nextcloud.yml` |
| **Sprinter** (ai2.jb.go.kr) | :18085 | :18087 | `/mnt/ssd16tb/prod-compose/docker-compose.sprinter.yml` |

## 아키텍처

```
┌─────────────┐     SSO      ┌──────────────┐
│   OWI       │────────────▶│  Nextcloud   │
│  (로그인)   │              │  (파일 저장) │
└─────────────┘              └──────┬───────┘
                                    │
                              JWT Token
                                    │
                                    ▼
                             ┌──────────────┐
                             │  OnlyOffice  │
                             │ (문서 편집)  │
                             └──────────────┘
```

## SSO 설정

- OWI 로그인 시 Nextcloud 자동 로그인 (nextcloud-sso 컨테이너)
- nginx `auth_request`로 OWI 세션 확인
- 9141+ 사용자 자동 프로비저닝 완료

## JWT 인증 설정

### OnlyOffice local.json

`/etc/onlyoffice/documentserver/local.json`:

```json
{
  "services": {
    "CoAuthoring": {
      "token": {
        "enable": {
          "browser": false,
          "request": {
            "inbox": true,
            "outbox": false
          }
        }
      },
      "secret": {
        "inbox": { "string": "JB_OnlyOffice_JWT_Secret_2026!" },
        "outbox": { "string": "JB_OnlyOffice_JWT_Secret_2026!" }
      },
      "request-filtering-agent": {
        "allowPrivateIPAddress": true
      },
      "requestDefaults": {
        "rejectUnauthorized": false
      }
    }
  },
  "storage": {
    "fs": {
      "secretString": "verysecretstring"
    }
  },
  "ipfilter": {
    "rules": [{ "address": "*", "allowed": true }],
    "useforrequest": true
  }
}
```

| 설정 | 값 | 설명 |
|------|------|------|
| `token.enable.browser` | `false` | api.js 접근에 JWT 불필요 |
| `token.enable.request.inbox` | `true` | 들어오는 요청에 JWT 검증 |
| `token.enable.request.outbox` | `false` | OnlyOffice 8.x는 발신 JWT 미지원 |
| `allowPrivateIPAddress` | `true` | Docker 내부 IP 허용 |

### Nextcloud OnlyOffice 앱 설정

```bash
# 확인
docker exec nextcloud php occ config:app:get onlyoffice jwt_secret
docker exec nextcloud php occ config:app:get onlyoffice DocumentServerInternalUrl
docker exec nextcloud php occ config:app:get onlyoffice StorageUrl

# 설정
docker exec nextcloud php occ config:app:set onlyoffice jwt_secret --value="JB_OnlyOffice_JWT_Secret_2026!"
docker exec nextcloud php occ config:app:set onlyoffice DocumentServerInternalUrl --value="http://onlyoffice/"
docker exec nextcloud php occ config:app:set onlyoffice StorageUrl --value="http://nextcloud/"
```

## nginx 설정 (필수)

OnlyOffice 캐시 파일(`/cache/`) 경로를 프록시해야 함:

```nginx
# OnlyOffice 메인
location ^~ /onlyoffice/ {
    proxy_pass http://192.168.0.201:8087/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
}

# OnlyOffice 캐시 (Editor.bin 등) - 필수!
location ^~ /cache/ {
    proxy_pass http://192.168.0.201:8087/cache/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
}
```

!!! warning "누락 시 증상"
    `/cache/` 경로가 없으면 문서 열기 시 "다운로드하지 못했습니다" 에러 발생

## 권한 수정

OnlyOffice 시작 후 권한 설정 필요 (entrypoint에 포함):

```bash
chown -R www-data:www-data /var/www/onlyoffice/documentserver
chown -R www-data:www-data /var/lib/onlyoffice/documentserver/App_Data
chmod -R 777 /var/lib/onlyoffice/documentserver/App_Data/cache
```

## 트러블슈팅

### "다운로드하지 못했습니다" 에러

**원인 1: nginx `/cache/` 경로 누락**

```bash
# 확인: Editor.bin URL 테스트
curl -I "https://ai.jb.go.kr/cache/files/data/xxx/Editor.bin/Editor.bin"
# 404면 nginx 설정 추가 필요
```

**원인 2: OnlyOffice DB 캐시된 에러**

```bash
# OnlyOffice task_result 테이블에서 에러 상태 확인
docker exec onlyoffice bash -c 'PGPASSWORD=onlyoffice psql -h localhost -U onlyoffice -d onlyoffice -c "SELECT id, status, status_info FROM task_result WHERE status = 5;"'

# 에러 캐시 삭제
docker exec onlyoffice bash -c 'PGPASSWORD=onlyoffice psql -h localhost -U onlyoffice -d onlyoffice -c "DELETE FROM task_result WHERE status = 5;"'

# 파일 캐시도 삭제
docker exec onlyoffice rm -rf /var/lib/onlyoffice/documentserver/App_Data/cache/files/data/*

# 서비스 재시작
docker exec onlyoffice supervisorctl restart ds:docservice ds:converter
```

### api.js 403 에러

- `token.enable.browser: false` 확인
- 파일 권한 확인: `chown -R www-data:www-data /var/www/onlyoffice`

### Editor.bin 403 에러

- `secure_link_secret` (nginx ds.conf)과 `storage.fs.secretString` (local.json) 일치 확인
- 둘 다 `verysecretstring`으로 설정

### Private IP 차단 에러

```
DNS lookup 192.168.x.x is not allowed. Because, It is private IP address.
```

- `request-filtering-agent.allowPrivateIPAddress: true` 설정
- `ALLOW_PRIVATE_IP_ADDRESS=true` 환경변수

### 디버그 로깅 활성화

```bash
# 로그 레벨 변경
docker exec onlyoffice bash -c "sed -i 's/\"level\": \"WARN\"/\"level\": \"DEBUG\"/' /etc/onlyoffice/documentserver/log4js/production.json"
docker exec onlyoffice supervisorctl restart ds:docservice

# 로그 확인
docker exec onlyoffice tail -f /var/log/onlyoffice/documentserver/docservice/out.log

# 원복
docker exec onlyoffice bash -c "sed -i 's/\"level\": \"DEBUG\"/\"level\": \"WARN\"/' /etc/onlyoffice/documentserver/log4js/production.json"
docker exec onlyoffice supervisorctl restart ds:docservice
```

## CallbackController.php 패치

OnlyOffice 8.x는 파일 다운로드 요청에 JWT를 포함하지 않음. hash 검증만으로 충분하므로 패치 적용:

**패치 위치**: `/var/www/html/custom_apps/onlyoffice/lib/Controller/CallbackController.php`

**Line ~249 (download bypass)**:
```php
if (!empty($this->config->getDocumentServerSecret())) {
    $header = \OC::$server->getRequest()->getHeader($this->config->jwtHeader());
    if (!empty($header)) {
        // JWT 있으면 검증
    } else {
        $this->logger->debug("Download without jwt header - hash is valid, proceeding");
        // JWT 없어도 hash가 유효하면 진행
    }
}
```

!!! warning "업데이트 주의"
    Nextcloud OnlyOffice 앱 업데이트 시 패치가 덮어씌워짐 - 업데이트 후 재패치 필요

## Sprinter 환경 (ai2.jb.go.kr)

학생 개발 환경으로, 프로덕션과 독립적으로 운영:

| 항목 | 프로덕션 | Sprinter |
|------|----------|----------|
| Nextcloud 포트 | 8085 | 18085 |
| OnlyOffice 포트 | 8087 | 18087 |
| Docker 네트워크 | nextcloud | prod-compose_sprinter |
| 컨테이너명 | nextcloud, onlyoffice | sprinter-nextcloud, sprinter-onlyoffice |

**Sprinter 설정 명령어**:
```bash
# Nextcloud OnlyOffice 설정
docker exec sprinter-nextcloud php occ config:app:set onlyoffice DocumentServerInternalUrl --value="http://sprinter-onlyoffice/"
docker exec sprinter-nextcloud php occ config:app:set onlyoffice StorageUrl --value="http://sprinter-nextcloud/"
docker exec sprinter-nextcloud php occ config:app:set onlyoffice jwt_secret --value="JB_OnlyOffice_JWT_Secret_2026!"
```
