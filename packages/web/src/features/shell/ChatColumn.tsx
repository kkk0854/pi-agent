/** 中栏：聊天主体（S-04 空态 + 会话/审批/Composer 全链路）。T01 的开发预览切换条已移除 */
import { ChatView } from '../chat/ChatView';

export function ChatColumn() {
  return <main className="relative flex h-full min-h-0 flex-1 flex-col bg-bg">{<ChatView />}</main>;
}
