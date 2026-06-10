/**
 * 条件日志工具 — 开发环境输出调试日志，生产构建自动抑制
 */

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'

export const logger = {
  /** 调试日志（仅开发环境输出） */
  debug: (...args: unknown[]) => { if (isDev) console.log(...args) },

  /** 警告日志（始终输出） */
  warn: (...args: unknown[]) => console.warn(...args),

  /** 错误日志（始终输出） */
  error: (...args: unknown[]) => console.error(...args),

  /** 信息日志（仅开发环境输出） */
  info: (...args: unknown[]) => { if (isDev) console.info(...args) },
}
