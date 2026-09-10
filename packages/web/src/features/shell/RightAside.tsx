/** 右栏（可折叠）：变更 / 自动化 / 分支树 / 用量 / 扩展 / 手机镜像（T04b 多端与自动化贯通） */
import { t } from '../../i18n';
import { useAppStore } from '../../store';
import { Tabs, TabsList, TabsPanel } from '../../components/ui/Tabs';
import { BranchTree } from '../branch/BranchTree';
import { ChangesPanel } from '../changes/ChangesPanel';
import { AutomationsPanel } from '../automations/AutomationsPanel';
import { UsageHeatmap } from '../usage/UsageHeatmap';
import { ExtensionsPanel } from '../extensions/ExtensionsPanel';
import { MirrorPanel } from '../mirror/MirrorPanel';

export function RightAside() {
  const collapsed = useAppStore((s) => s.rightAsideCollapsed);

  if (collapsed) return null;

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-panel">
      <Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
        <TabsList
          items={[
            { value: 'changes', label: t('aside.changes') },
            { value: 'automations', label: t('aside.automations') },
            { value: 'branch', label: t('aside.branchTree') },
            { value: 'usage', label: t('aside.usage') },
            { value: 'extensions', label: t('aside.extensions') },
            { value: 'mirror', label: t('aside.mirror') },
          ]}
        />
        <TabsPanel value="changes">
          <ChangesPanel />
        </TabsPanel>
        <TabsPanel value="automations">
          <AutomationsPanel />
        </TabsPanel>
        <TabsPanel value="branch">
          <BranchTree />
        </TabsPanel>
        <TabsPanel value="usage">
          <UsageHeatmap />
        </TabsPanel>
        <TabsPanel value="extensions">
          <ExtensionsPanel />
        </TabsPanel>
        <TabsPanel value="mirror">
          <MirrorPanel />
        </TabsPanel>
      </Tabs>
    </aside>
  );
}
