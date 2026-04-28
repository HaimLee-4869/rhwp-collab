/**
 * rHWP CRDT - Conflict-free Replicated Data Types for Real-time Collaboration
 *
 * Lamport Timestamp + Site ID 기반 텍스트 CRDT 구현
 * - 각 문자에 고유 ID 부여 (siteId, counter)
 * - 삽입/삭제 operation만 전송 (전체 문서 X)
 * - 충돌 시 결정적 병합 (siteId로 순서 결정)
 */

class CRDT {
    constructor(siteId) {
        this.siteId = siteId;
        this.counter = 0;
        this.state = []; // [{id: {site, counter}, char, deleted}]
        this.pending = []; // 아직 적용 안 된 원격 operation
    }

    /**
     * 고유 ID 생성
     */
    generateId() {
        return {
            site: this.siteId,
            counter: ++this.counter
        };
    }

    /**
     * ID 비교 (정렬용)
     * counter가 같으면 siteId로 결정 (결정적)
     */
    compareIds(a, b) {
        if (a.counter !== b.counter) {
            return a.counter - b.counter;
        }
        return a.site.localeCompare(b.site);
    }

    /**
     * 삽입 위치 찾기 (이진 탐색)
     */
    findInsertIndex(id) {
        let left = 0;
        let right = this.state.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.compareIds(this.state[mid].id, id) < 0) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        return left;
    }

    /**
     * 로컬 삽입
     * @param {number} visibleIndex - 화면상 위치 (삭제된 문자 제외)
     * @param {string} char - 삽입할 문자
     * @returns {Object} operation (브로드캐스트용)
     */
    localInsert(visibleIndex, char) {
        const id = this.generateId();

        // visibleIndex를 실제 state 인덱스로 변환
        let actualIndex = 0;
        let visCount = 0;

        while (actualIndex < this.state.length && visCount < visibleIndex) {
            if (!this.state[actualIndex].deleted) {
                visCount++;
            }
            actualIndex++;
        }

        // 삽입 위치의 앞/뒤 ID 참조
        const beforeId = actualIndex > 0 ? this.state[actualIndex - 1].id : null;
        const afterId = actualIndex < this.state.length ? this.state[actualIndex].id : null;

        const element = { id, char, deleted: false };

        // state에 정렬된 위치에 삽입
        const insertIdx = this.findInsertIndex(id);
        this.state.splice(insertIdx, 0, element);

        return {
            type: 'insert',
            id,
            char,
            beforeId,
            afterId,
            siteId: this.siteId,
            counter: this.counter
        };
    }

    /**
     * 로컬 삭제
     * @param {number} visibleIndex - 화면상 위치
     * @returns {Object} operation (브로드캐스트용)
     */
    localDelete(visibleIndex) {
        let visCount = 0;

        for (let i = 0; i < this.state.length; i++) {
            if (!this.state[i].deleted) {
                if (visCount === visibleIndex) {
                    this.state[i].deleted = true;
                    return {
                        type: 'delete',
                        id: this.state[i].id,
                        siteId: this.siteId
                    };
                }
                visCount++;
            }
        }
        return null;
    }

    /**
     * 원격 operation 적용
     */
    applyRemote(operation) {
        // Lamport clock 업데이트
        if (operation.counter && operation.counter >= this.counter) {
            this.counter = operation.counter + 1;
        }

        if (operation.type === 'insert') {
            return this.remoteInsert(operation);
        } else if (operation.type === 'delete') {
            return this.remoteDelete(operation);
        }
        return null;
    }

    /**
     * 원격 삽입 적용
     */
    remoteInsert(op) {
        // 이미 존재하는지 확인 (중복 방지)
        const exists = this.state.find(e =>
            e.id.site === op.id.site && e.id.counter === op.id.counter
        );
        if (exists) return null;

        const element = {
            id: op.id,
            char: op.char,
            deleted: false
        };

        const insertIdx = this.findInsertIndex(op.id);
        this.state.splice(insertIdx, 0, element);

        // 화면상 위치 계산 (삭제된 것 제외)
        let visibleIndex = 0;
        for (let i = 0; i < insertIdx; i++) {
            if (!this.state[i].deleted) visibleIndex++;
        }

        return { type: 'insert', index: visibleIndex, char: op.char };
    }

    /**
     * 원격 삭제 적용
     */
    remoteDelete(op) {
        let visibleIndex = 0;

        for (let i = 0; i < this.state.length; i++) {
            const elem = this.state[i];

            if (elem.id.site === op.id.site && elem.id.counter === op.id.counter) {
                if (!elem.deleted) {
                    elem.deleted = true;
                    return { type: 'delete', index: visibleIndex };
                }
                return null; // 이미 삭제됨
            }

            if (!elem.deleted) visibleIndex++;
        }
        return null;
    }

    /**
     * 현재 텍스트 반환
     */
    getText() {
        return this.state
            .filter(e => !e.deleted)
            .map(e => e.char)
            .join('');
    }

    /**
     * 텍스트로 초기화 (문서 로드 시)
     */
    initFromText(text, originSiteId = 'origin') {
        this.state = [];
        for (let i = 0; i < text.length; i++) {
            this.state.push({
                id: { site: originSiteId, counter: i + 1 },
                char: text[i],
                deleted: false
            });
        }
        this.counter = text.length;
    }

    /**
     * 상태 직렬화 (저장/복원용)
     */
    serialize() {
        return {
            siteId: this.siteId,
            counter: this.counter,
            state: this.state
        };
    }

    /**
     * 상태 복원
     */
    deserialize(data) {
        this.siteId = data.siteId;
        this.counter = data.counter;
        this.state = data.state;
    }
}

/**
 * 문단 단위 CRDT 관리자
 * HWP는 문단(paragraph) 단위로 구성되므로, 각 문단에 CRDT 인스턴스 할당
 */
class DocumentCRDT {
    constructor(siteId) {
        this.siteId = siteId;
        this.paragraphs = new Map(); // paragraphId -> CRDT
        this.paragraphOrder = []; // 문단 순서 (CRDT로 관리)
        this.orderCRDT = new CRDT(siteId + '-order');
        this.version = 0;
    }

    /**
     * 문단 CRDT 가져오기 (없으면 생성)
     */
    getParagraph(paraId) {
        if (!this.paragraphs.has(paraId)) {
            this.paragraphs.set(paraId, new CRDT(this.siteId + '-p' + paraId));
        }
        return this.paragraphs.get(paraId);
    }

    /**
     * 텍스트 삽입
     */
    insertText(paraId, charIndex, text) {
        const operations = [];
        const para = this.getParagraph(paraId);

        for (let i = 0; i < text.length; i++) {
            const op = para.localInsert(charIndex + i, text[i]);
            op.paraId = paraId;
            operations.push(op);
        }

        this.version++;
        return operations;
    }

    /**
     * 텍스트 삭제
     */
    deleteText(paraId, charIndex, length) {
        const operations = [];
        const para = this.getParagraph(paraId);

        // 뒤에서부터 삭제 (인덱스 변화 방지)
        for (let i = length - 1; i >= 0; i--) {
            const op = para.localDelete(charIndex + i);
            if (op) {
                op.paraId = paraId;
                operations.push(op);
            }
        }

        this.version++;
        return operations;
    }

    /**
     * 원격 operation 적용
     */
    applyRemoteOperations(operations) {
        const changes = [];

        for (const op of operations) {
            if (op.siteId === this.siteId) continue; // 자신의 operation 무시

            const para = this.getParagraph(op.paraId);
            const change = para.applyRemote(op);

            if (change) {
                change.paraId = op.paraId;
                changes.push(change);
            }
        }

        if (changes.length > 0) {
            this.version++;
        }

        return changes;
    }

    /**
     * 문단 텍스트 가져오기
     */
    getParagraphText(paraId) {
        if (!this.paragraphs.has(paraId)) return '';
        return this.paragraphs.get(paraId).getText();
    }

    /**
     * 버전 체크 (동기화 필요 여부)
     */
    getVersion() {
        return this.version;
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.CRDT = CRDT;
    window.DocumentCRDT = DocumentCRDT;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CRDT, DocumentCRDT };
}
