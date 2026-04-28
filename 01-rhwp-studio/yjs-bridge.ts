/**
 * rHWP Yjs CRDT 브릿지
 *
 * rHWP의 편집 명령(Command)을 Yjs Y.Array<Y.Map>에 직렬화하여
 * 여러 사용자의 동시 편집을 CRDT로 자동 병합합니다.
 *
 * 동작 원리:
 * 1. 로컬 편집 → Command 실행 → Y.Array에 operation push
 * 2. Y.Array observe → 원격 operation → Command 재실행
 * 3. siteId로 자기 변경 제외 (무한 루프 방지)
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { WasmBridge } from './wasm-bridge';
import type { EventBus } from './event-bus';
import type { DocumentPosition } from './types';
import {
  InsertTextCommand,
  DeleteTextCommand,
  InsertLineBreakCommand,
  InsertTabCommand,
  SplitParagraphCommand,
  MergeParagraphCommand,
  type EditCommand,
} from '@/engine/command';

export interface YjsBridgeConfig {
  serverUrl: string;       // wss://ai.jb.go.kr/rhwp-yjs
  docName: string;         // collab room ID (ex. 'hwp-54d3b97...')
  userId: string;          // 사용자 식별자
  userName: string;        // 표시 이름
}

interface SerializedOp {
  type: string;
  paraId: number;
  charIndex: number;
  text?: string;
  length?: number;
  direction?: string;
  siteId: string;
  timestamp: number;
  seq: number;             // Yjs 내부 시퀀스
}

export class YjsBridge {
  private wasm: WasmBridge;
  private eventBus: EventBus;
  private ydoc: Y.Doc;
  private yops: Y.Array<Y.Map<any>>;
  private provider: WebsocketProvider | null = null;
  private enabled = false;
  private siteId = '';
  private isApplyingRemote = false;
  private opCounter = 0;
  private lastAppliedIndex = 0;

  constructor(wasm: WasmBridge, eventBus: EventBus) {
    this.wasm = wasm;
    this.eventBus = eventBus;
    this.ydoc = new Y.Doc();
    this.yops = this.ydoc.getArray<Y.Map<any>>('operations');
  }

  /** Yjs 브릿지 활성화 */
  async connect(config: YjsBridgeConfig): Promise<void> {
    console.log('[yjs] connect() 호출:', config);

    if (this.enabled) {
      console.warn('[yjs] 이미 연결됨');
      return;
    }

    this.siteId = config.userId + '-' + Date.now();

    try {
      this.provider = new WebsocketProvider(
        config.serverUrl,
        config.docName,
        this.ydoc,
        { connect: true }
      );
      console.log('[yjs] WebsocketProvider 생성 완료');
    } catch (err) {
      console.error('[yjs] WebsocketProvider 생성 실패:', err);
      throw err;
    }

    // Awareness (참여자 표시)
    this.provider.awareness.setLocalStateField('user', {
      id: config.userId,
      name: config.userName,
      color: this.getUserColor(config.userId),
      siteId: this.siteId
    });

    this.provider.on('status', (event: { status: string }) => {
      console.log('[yjs] 연결 상태:', event.status);
      this.eventBus.emit('yjs-status', event.status);
    });

    this.provider.on('sync', (isSynced: boolean) => {
      console.log('[yjs] 동기화 상태:', isSynced);
      if (isSynced) {
        // 첫 동기화 완료 - 이미 적용된 operation 건너뛰기
        this.lastAppliedIndex = this.yops.length;
        this.eventBus.emit('yjs-synced');
      }
    });

    this.provider.awareness.on('change', () => {
      const states = Array.from(this.provider!.awareness.getStates().values())
        .map((s: any) => s.user)
        .filter((u: any) => u);
      this.eventBus.emit('yjs-users-changed', states);
    });

    // Y.Array 변경 감지 → 원격 operation 적용
    this.yops.observe((event) => {
      if (event.transaction.origin === this) return;  // 자기 변경 무시
      this.handleRemoteOperations(event);
    });

    // EventBus에서 편집 이벤트 구독
    this.subscribeToLocalEdits();

    this.enabled = true;
    console.log('[yjs] 연결 시작:', config.docName);
  }

  /** 연결 해제 */
  disconnect(): void {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.enabled = false;
  }

  /** 로컬 편집 이벤트 구독 */
  private subscribeToLocalEdits(): void {
    this.eventBus.on('command-executed', (...args: unknown[]) => {
      const cmd = args[0] as EditCommand;
      if (!this.enabled || this.isApplyingRemote) return;
      this.broadcastLocalEdit(cmd);
    });
  }

  /** 로컬 편집을 Y.Array에 추가 */
  private broadcastLocalEdit(command: EditCommand): void {
    const serialized = this.serializeCommand(command);
    if (!serialized) return;

    const yop = new Y.Map<any>();
    // Transaction origin을 this로 지정 → observe 콜백에서 자기 변경 제외
    this.ydoc.transact(() => {
      yop.set('type', serialized.type);
      yop.set('paraId', serialized.paraId);
      yop.set('charIndex', serialized.charIndex);
      if (serialized.text !== undefined) yop.set('text', serialized.text);
      if (serialized.length !== undefined) yop.set('length', serialized.length);
      if (serialized.direction !== undefined) yop.set('direction', serialized.direction);
      yop.set('siteId', this.siteId);
      yop.set('timestamp', Date.now());
      yop.set('seq', ++this.opCounter);
      this.yops.push([yop]);
    }, this);  // origin = this

    // 로컬 이미 적용되었으니 인덱스 업데이트
    this.lastAppliedIndex = this.yops.length;
  }

  /** 원격 operation 적용 */
  private handleRemoteOperations(event: Y.YArrayEvent<Y.Map<any>>): void {
    // 새로 추가된 operation만 처리
    const currentLength = this.yops.length;
    const newOps: Y.Map<any>[] = [];
    for (let i = this.lastAppliedIndex; i < currentLength; i++) {
      const op = this.yops.get(i);
      if (op) newOps.push(op);
    }
    this.lastAppliedIndex = currentLength;

    if (newOps.length === 0) return;

    console.log('[yjs] 원격 operation 수신:', newOps.length, '개');

    this.isApplyingRemote = true;
    try {
      for (const yop of newOps) {
        // 자기 siteId는 스킵 (이미 로컬에 적용됨)
        const opSiteId = yop.get('siteId');
        if (opSiteId === this.siteId) continue;

        const op: SerializedOp = {
          type: yop.get('type'),
          paraId: yop.get('paraId') ?? 0,
          charIndex: yop.get('charIndex') ?? 0,
          text: yop.get('text'),
          length: yop.get('length'),
          direction: yop.get('direction'),
          siteId: opSiteId,
          timestamp: yop.get('timestamp') ?? 0,
          seq: yop.get('seq') ?? 0
        };
        const command = this.deserializeOperation(op);
        if (command) {
          try {
            command.execute(this.wasm);
          } catch (e) {
            console.error('[yjs] operation 적용 실패:', op.type, e);
          }
        }
      }
      this.eventBus.emit('document-changed');
      this.eventBus.emit('remote-edits-applied');
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /** Command → JSON 직렬화 */
  private serializeCommand(cmd: EditCommand): SerializedOp | null {
    const base = {
      siteId: this.siteId,
      timestamp: Date.now(),
      seq: this.opCounter
    };

    if (cmd instanceof InsertTextCommand) {
      return {
        ...base,
        type: 'insertText',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0,
        text: (cmd as any).text ?? ''
      };
    }
    if (cmd instanceof DeleteTextCommand) {
      return {
        ...base,
        type: 'deleteText',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0,
        length: (cmd as any).count ?? 1,
        direction: (cmd as any).direction ?? 'forward'
      };
    }
    if (cmd instanceof InsertLineBreakCommand) {
      return {
        ...base,
        type: 'insertLineBreak',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }
    if (cmd instanceof InsertTabCommand) {
      return {
        ...base,
        type: 'insertTab',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }
    if (cmd instanceof SplitParagraphCommand) {
      return {
        ...base,
        type: 'splitParagraph',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }
    if (cmd instanceof MergeParagraphCommand) {
      return {
        ...base,
        type: 'mergeParagraph',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: 0
      };
    }
    return null;
  }

  /** JSON → Command 역직렬화 */
  private deserializeOperation(op: SerializedOp): EditCommand | null {
    const position: DocumentPosition = {
      sectionIndex: 0,
      paragraphIndex: op.paraId,
      charOffset: op.charIndex
    };

    switch (op.type) {
      case 'insertText':
        return new InsertTextCommand(position, op.text || '', op.timestamp);
      case 'deleteText':
        return new DeleteTextCommand(
          position,
          op.length || 1,
          (op.direction as any) || 'forward',
          undefined,
          op.timestamp
        );
      case 'insertLineBreak':
        return new InsertLineBreakCommand(position);
      case 'insertTab':
        return new InsertTabCommand(position);
      case 'splitParagraph':
        return new SplitParagraphCommand(position);
      case 'mergeParagraph':
        return new MergeParagraphCommand(position);
      default:
        console.warn('[yjs] 알 수 없는 operation 타입:', op.type);
        return null;
    }
  }

  /** 사용자별 색상 (siteId 해시) */
  private getUserColor(userId: string): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
                    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  /** 연결 상태 */
  isConnected(): boolean {
    return this.enabled && this.provider !== null &&
           this.provider.wsconnected;
  }

  /** 현재 참여자 목록 */
  getUsers(): Array<{ id: string; name: string; color: string; siteId: string }> {
    if (!this.provider) return [];
    return Array.from(this.provider.awareness.getStates().values())
      .map((s: any) => s.user)
      .filter((u: any) => u);
  }

  /** 원격 편집 적용 중 여부 (input-handler 등에서 확인용) */
  isApplyingRemoteEdit(): boolean {
    return this.isApplyingRemote;
  }
}

// ─── 전역 인스턴스 관리 ────────────────────────────
let globalYjsBridge: YjsBridge | null = null;

export function initYjsBridge(wasm: WasmBridge, eventBus: EventBus): YjsBridge {
  if (globalYjsBridge) return globalYjsBridge;
  globalYjsBridge = new YjsBridge(wasm, eventBus);
  return globalYjsBridge;
}

export function getYjsBridge(): YjsBridge | null {
  return globalYjsBridge;
}
