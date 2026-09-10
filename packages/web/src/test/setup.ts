/** 测试环境初始化：每用例后清理 DOM（@testing-library） */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
