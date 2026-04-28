#!/usr/bin/env python3
"""
OWI → Nextcloud 사용자 동기화
- OWI DB에서 사용자 목록 조회
- Nextcloud에 없는 사용자 생성
- 크론으로 매시간 실행
"""
import subprocess
import psycopg2
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# OWI DB 연결 정보
OWI_DB = {
    'host': '192.168.0.201',
    'port': 5432,
    'dbname': 'customui',
    'user': 'admin',
    'password': 'uMPbG7ibHx-G6-e_FHsqHpKXV25gLeGs'
}

def get_owi_users():
    """OWI DB에서 활성 사용자 목록 조회"""
    conn = psycopg2.connect(**OWI_DB)
    try:
        cur = conn.cursor()
        cur.execute('''
            SELECT email, name
            FROM "user"
            WHERE email IS NOT NULL
              AND email != ''
              AND role != 'pending'
        ''')
        users = cur.fetchall()
        logger.info(f"OWI에서 {len(users)}명 조회")
        return users
    finally:
        conn.close()

def get_nc_users():
    """Nextcloud 사용자 목록 조회"""
    result = subprocess.run(
        ['docker', 'exec', '-u', 'www-data', 'nextcloud',
         'php', 'occ', 'user:list', '--output=json'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.error(f"Nextcloud 사용자 목록 조회 실패: {result.stderr}")
        return set()

    import json
    users = json.loads(result.stdout)
    return set(users.keys())

def create_nc_user(email, name):
    """Nextcloud 사용자 생성"""
    import os
    import secrets

    # 랜덤 비밀번호 생성 (SSO만 사용하므로 실제로 사용 안함)
    password = secrets.token_urlsafe(16) + "!Aa1"

    env = os.environ.copy()
    env['OC_PASS'] = password

    result = subprocess.run(
        ['docker', 'exec', '-u', 'www-data', '-e', f'OC_PASS={password}',
         'nextcloud', 'php', 'occ', 'user:add',
         '--password-from-env', f'--display-name={name}', email],
        capture_output=True, text=True
    )

    if result.returncode == 0:
        logger.info(f"생성: {email} ({name})")
        return True
    elif 'already exists' in result.stderr.lower():
        return True  # 이미 존재
    else:
        logger.error(f"생성 실패: {email} - {result.stderr}")
        return False

def sync_users():
    """사용자 동기화 실행"""
    owi_users = get_owi_users()
    nc_users = get_nc_users()

    created = 0
    skipped = 0
    failed = 0

    for email, name in owi_users:
        if email.lower() in [u.lower() for u in nc_users]:
            skipped += 1
            continue

        if create_nc_user(email, name or email.split('@')[0]):
            created += 1
        else:
            failed += 1

    logger.info(f"동기화 완료: 생성 {created}, 건너뜀 {skipped}, 실패 {failed}")
    return created, skipped, failed

if __name__ == '__main__':
    try:
        sync_users()
    except Exception as e:
        logger.error(f"동기화 오류: {e}")
        sys.exit(1)
