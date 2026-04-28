/**
 * rHWP iframe 협업 브릿지
 *
 * Nextcloud 등 외부 시스템의 iframe 내에서 실행될 때
 * postMessage를 통해 편집 operation을 동기화합니다.
 *
 * 통신 프로토콜:
 * - rHWP → 부모: rhwp-edit (로컬 편집 발생)
 * - rHWP → 부모: rhwp-cursor (커서 위치 변경)
 * - 부모 → rHWP: rhwp-enable-collab (협업 모드 활성화)
 * - 부모 → rHWP: rhwp-apply-edit (원격 편집 적용)
 */
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

export interface IframeCollabConfig {
  siteId: string;
  captureOperations: boolean;
}

export class IframeCollabBridge {
  private wasm: WasmBridge;
  private eventBus: EventBus;
  private enabled = false;
  private siteId = '';
  private isApplyingRemote = false;
  private operationCounter = 0;

  constructor(wasm: WasmBridge, eventBus: EventBus) {
    this.wasm = wasm;
    this.eventBus = eventBus;
    this.setupMessageListener();
  }

  /** postMessage 리스너 설정 */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;

      switch (event.data.type) {
        case 'rhwp-enable-collab':
          this.enableCollaboration(event.data.config);
          break;

        case 'rhwp-apply-edit':
          this.applyRemoteEdit(event.data.change);
          break;

        case 'rhwp-request-cursor':
          this.sendCursorPosition();
          break;
      }
    });
  }

  /** 협업 모드 활성화 */
  private enableCollaboration(config: IframeCollabConfig): void {
    this.enabled = config.captureOperations;
    this.siteId = config.siteId || `site-${Date.now()}`;
    console.log('[IframeCollab] 활성화:', this.siteId);

    // 편집 이벤트 구독
    this.subscribeToEdits();
  }

  /** 편집 이벤트 구독 */
  private subscribeToEdits(): void {
    // EventBus에서 편집 이벤트 수신
    this.eventBus.on('command-executed', (...args: unknown[]) => {
      const cmd = args[0] as EditCommand;
      if (!this.enabled || this.isApplyingRemote) return;
      this.broadcastEdit(cmd);
    });

    // 커서 이동 이벤트
    this.eventBus.on('cursor-moved', (...args: unknown[]) => {
      const position = args[0] as DocumentPosition;
      if (!this.enabled) return;
      this.sendCursorPosition(position);
    });

    // 선택 영역 변경
    this.eventBus.on('selection-changed', (...args: unknown[]) => {
      const selection = args[0];
      if (!this.enabled) return;
      this.sendSelection(selection);
    });
  }

  /** 로컬 편집을 부모 창에 전송 */
  broadcastEdit(command: EditCommand): void {
    if (!this.enabled || this.isApplyingRemote) return;
    if (!window.parent || window.parent === window) return;

    const editData = this.serializeCommand(command);
    if (!editData) return;

    window.parent.postMessage({
      type: 'rhwp-edit',
      ...editData,
      siteId: this.siteId,
      counter: ++this.operationCounter,
      timestamp: Date.now()
    }, '*');
  }

  /** EditCommand를 직렬화 */
  private serializeCommand(cmd: EditCommand): any | null {
    if (cmd instanceof InsertTextCommand) {
      return {
        operation: 'insertText',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0,
        text: (cmd as any).text ?? ''
      };
    }

    if (cmd instanceof DeleteTextCommand) {
      return {
        operation: 'deleteText',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0,
        length: (cmd as any).count ?? 1,
        direction: (cmd as any).direction ?? 'forward'
      };
    }

    if (cmd instanceof InsertLineBreakCommand) {
      return {
        operation: 'insertLineBreak',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }

    if (cmd instanceof InsertTabCommand) {
      return {
        operation: 'insertTab',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }

    if (cmd instanceof SplitParagraphCommand) {
      return {
        operation: 'splitParagraph',
        paraId: (cmd as any).position?.paragraphIndex ?? 0,
        charIndex: (cmd as any).position?.charOffset ?? 0
      };
    }

    if (cmd instanceof MergeParagraphCommand) {
      return {
        operation: 'mergeParagraph',
        paraId: (cmd as any).position?.paragraphIndex ?? 0
      };
    }

    // 지원하지 않는 명령
    console.log('[IframeCollab] 미지원 명령:', cmd.type);
    return null;
  }

  /** 원격 편집 적용 */
  private applyRemoteEdit(change: any): void {
    if (!change) return;

    this.isApplyingRemote = true;

    try {
      const command = this.deserializeChange(change);
      if (command) {
        command.execute(this.wasm);
        this.eventBus.emit('document-changed');
        this.eventBus.emit('remote-edit-applied', change);
      }
    } catch (e) {
      console.error('[IframeCollab] 원격 편집 적용 실패:', e);
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /** 직렬화된 변경을 EditCommand로 변환 */
  private deserializeChange(change: any): EditCommand | null {
    const position: DocumentPosition = {
      sectionIndex: 0,
      paragraphIndex: change.paraId ?? 0,
      charOffset: change.index ?? change.charIndex ?? 0
    };

    switch (change.type) {
      case 'insert':
        return new InsertTextCommand(position, change.char || '', Date.now());

      case 'delete':
        return new DeleteTextCommand(position, 1, 'forward', undefined, Date.now());

      case 'insertText':
        return new InsertTextCommand(position, change.text || change.char || '', Date.now());

      case 'deleteText':
        return new DeleteTextCommand(position, change.length || 1, change.direction || 'forward', undefined, Date.now());

      case 'insertLineBreak':
        return new InsertLineBreakCommand(position);

      case 'insertTab':
        return new InsertTabCommand(position);

      case 'splitParagraph':
        return new SplitParagraphCommand(position);

      case 'mergeParagraph':
        return new MergeParagraphCommand(position);

      default:
        console.warn('[IframeCollab] 알 수 없는 변경 유형:', change.type);
        return null;
    }
  }

  /** 커서 위치 전송 */
  sendCursorPosition(position?: DocumentPosition): void {
    if (!window.parent || window.parent === window) return;

    // 현재 커서의 화면 좌표 계산
    const cursorElement = document.querySelector('.caret-line');
    if (!cursorElement) return;

    const rect = cursorElement.getBoundingClientRect();

    window.parent.postMessage({
      type: 'rhwp-cursor',
      position: position,
      screenPosition: {
        x: rect.left,
        y: rect.top
      },
      siteId: this.siteId,
      isTyping: this.isTyping()
    }, '*');
  }

  /** 선택 영역 전송 */
  private sendSelection(selection: any): void {
    if (!window.parent || window.parent === window) return;

    const selectionElement = document.querySelector('.text-selection');
    if (!selectionElement) {
      window.parent.postMessage({
        type: 'rhwp-selection',
        selection: null,
        siteId: this.siteId
      }, '*');
      return;
    }

    const rect = selectionElement.getBoundingClientRect();

    window.parent.postMessage({
      type: 'rhwp-selection',
      selection: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      },
      siteId: this.siteId
    }, '*');
  }

  /** 입력 중인지 확인 (최근 500ms 내 편집 발생) */
  private lastEditTime = 0;
  private isTyping(): boolean {
    return Date.now() - this.lastEditTime < 500;
  }

  /** 명시적으로 편집 시점 기록 */
  markEdit(): void {
    this.lastEditTime = Date.now();
  }

  /** 원격 편집 적용 중인지 */
  isApplyingRemoteOperation(): boolean {
    return this.isApplyingRemote;
  }

  /** 협업 모드 활성화 여부 */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// 전역 인스턴스
let globalBridge: IframeCollabBridge | null = null;

export function getIframeCollabBridge(): IframeCollabBridge | null {
  return globalBridge;
}

export function initIframeCollabBridge(wasm: WasmBridge, eventBus: EventBus): IframeCollabBridge {
  globalBridge = new IframeCollabBridge(wasm, eventBus);
  return globalBridge;
}
