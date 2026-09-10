/**
 * 命令面板开关状态（P-06）：全局 Cmd/Ctrl+K 由 App 监听后 toggle；面板自身读写 open。
 */
import { create } from 'zustand';

interface CommandPaletteStore {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
