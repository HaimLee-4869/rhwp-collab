#!/bin/bash
# OWI 사용자를 Nextcloud에 동기화
# 사용: bash /home/gil/prod-compose/sync-owi-to-nextcloud.sh

set -e
LOG=/var/log/nextcloud-sync.log
exec > >(tee -a $LOG) 2>&1

echo "=== $(date) OWI → Nextcloud 사용자 동기화 시작 ==="

# OWI DB에서 사용자 조회
PGPASSWORD='uMPbG7ibHx-G6-e_FHsqHpKXV25gLeGs' psql -h 192.168.0.201 -U admin -d customui -t -A -F'|' -c "
SELECT email, COALESCE(name, split_part(email, '@', 1))
FROM \"user\"
WHERE email IS NOT NULL
  AND email != ''
  AND role != 'pending'
ORDER BY created_at DESC
" | while IFS='|' read -r email name; do
    [ -z "$email" ] && continue

    # 비밀번호 생성 (SSO만 사용하므로 실제로는 안씀)
    pass="NC_$(echo "$email" | md5sum | head -c12)!Aa"

    # 사용자 생성 (이미 존재하면 무시)
    result=$(docker exec -u www-data -e OC_PASS="$pass" nextcloud php occ user:add --password-from-env --display-name="$name" "$email" 2>&1)

    if echo "$result" | grep -q "was created"; then
        echo "생성: $email"
    fi
done

echo "=== $(date) 동기화 완료 ==="
