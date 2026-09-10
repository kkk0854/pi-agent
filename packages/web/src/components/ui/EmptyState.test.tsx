/** EmptyState 组件渲染冒烟测试（S-04） */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('渲染标题、描述与动作按钮', () => {
    render(
      <EmptyState
        title="还没有项目"
        description="添加一个本地目录作为项目"
        action={<button type="button">添加项目</button>}
      />,
    );
    expect(screen.getByText('还没有项目')).toBeTruthy();
    expect(screen.getByText('添加一个本地目录作为项目')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加项目' })).toBeTruthy();
  });

  it('无描述/动作时不崩溃（S-04：不空白不崩溃）', () => {
    render(<EmptyState title="仅标题" />);
    expect(screen.getByText('仅标题')).toBeTruthy();
  });
});
