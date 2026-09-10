/**
 * 入口（架构 §2.5 main.tsx）：
 * T01 直接挂载三栏壳；T02 在此 bootstrap：读 window.__PI_AGENT_HOST__ → createRuntime → framesink。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点');
}

// 开发提示：离线/在线状态由 Sidebar 底部徽标呈现（不弹窗）
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
