/**
 * i18n 机制（V-06 / Q-I）：t(key) 取文案，支持 {var} 插值。
 * 本轮仅 zh-CN；新增语言 = 新增同 shape 的字典 + locale 切换。
 */
import { zhCN, type MessageKey } from './zh-CN';

export type { MessageKey };
export { zhCN };

type Dict = Record<MessageKey, string>;
const dictionaries: Record<string, Dict> = { 'zh-CN': zhCN as unknown as Dict };
let currentLocale = 'zh-CN';

/** 切换 locale（预留；当前仅 zh-CN） */
export function setLocale(locale: string): void {
  if (dictionaries[locale]) currentLocale = locale;
}

/** 取文案：t('empty.noProject.title')；插值：t('greet', {name}) → 字典中 '你好 {name}' */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] ?? dictionaries['zh-CN']!;
  let text: string = dict[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
