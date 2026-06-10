/**
 * Electron 主进程共享工具函数
 * 从 main.ts / claudeProcess.ts / terminalProcess.ts / connectionService.ts 提取合并
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'

// ── Claude Code 路径编码 (Windows: C:\ → C--, / → -) ──────

/** 将文件系统路径编码为 Claude Code 的项目目录名格式 */
export function encodeClaudePath(p: string): string {
  return p.replace(':\\', '--').replace(':/', '--').replace(/\//g, '-').replace(/\\/g, '-')
}

/** 将 Claude Code 编码的路径解码为文件系统路径 */
export function decodeClaudePath(encoded: string): string {
  // Claude Code 格式: C--Users-xxx → C:\Users\xxx
  // Linux/macOS: --home-user → /home/user
  const driveMatch = encoded.match(/^([A-Za-z])--/)
  if (driveMatch) {
    // Windows 盘符路径
    const drive = driveMatch[1]
    const rest = encoded.slice(drive.length + 2) // 跳过 "C--"
    return drive + ':\\' + rest.replace(/-/g, '\\')
  }
  if (encoded.startsWith('--')) {
    // Unix 根路径
    return '/' + encoded.slice(2).replace(/-/g, '/')
  }
  // 无法判断的格式，尝试简单替换
  return encoded.replace(/--/g, ':\\').replace(/-/g, '\\')
}

// ── Claude CLI 二进制路径解析 ────────────────────────────

let _claudeBinCache: string | null = null

/** 解析 claude CLI 可执行文件路径（模块级缓存，仅解析一次） */
export function resolveClaudePath(): string {
  if (_claudeBinCache) return _claudeBinCache
  try {
    if (process.platform === 'win32') {
      const out = execSync('where claude.cmd', { timeout: 5000, windowsHide: true })
      const lines = out.toString().trim().split('\n')
      _claudeBinCache = lines[0]?.trim() || 'claude.cmd'
    } else {
      _claudeBinCache = 'claude'
    }
  } catch {
    _claudeBinCache = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  }
  return _claudeBinCache
}

// ── API Key 脱敏 ────────────────────────────────────────

/** 仅显示 API Key 的前3位和后4位，中间用 **** 遮蔽 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}

// ── JSONL 安全读取 ──────────────────────────────────────

/** 读取 JSONL 文件，跳过不完整/损坏的行（Claude CLI 可能正在写入最后一行） */
export function readJsonlSafe(filePath: string): any[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n')
    const results: any[] = []
    let parseErrors = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        results.push(JSON.parse(line))
        parseErrors = 0
      } catch {
        parseErrors++
        if (i < lines.length - 1 && parseErrors <= 1) {
          console.warn('[jsonl] 解析失败 (行 ' + i + '):', line.slice(0, 80))
        }
      }
    }
    return results
  } catch { return [] }
}

// ── 文件写入队列（防 TOCTOU 竞态）────────────────────────

const writeQueues = new Map<string, Promise<void>>()

/** 串行化同一文件的写入操作，防止读-改-写 TOCTOU 竞态 */
export function enqueueFileWrite(filePath: string, writeFn: () => void): void {
  const prev = writeQueues.get(filePath) || Promise.resolve()
  const next = prev.then(() => {
    try {
      writeFn()
    } catch (err) {
      console.error(`[file-queue] 写入 ${path.basename(filePath)} 失败:`, err)
    }
  }).catch(() => { /* 队列链不断 */ })
  writeQueues.set(filePath, next)
}

/** 原子读-改-写：在整个周期内持有文件锁，返回操作结果 */
export async function withFileLock<T>(filePath: string, fn: () => T): Promise<T> {
  const prev = writeQueues.get(filePath) || Promise.resolve()
  // 使用 definite assignment assertion — catch 块 re-throw 保证到达 return 时 result 已被赋值
  let result!: T
  const next = prev.then(() => {
    result = fn()
  }).catch((err) => {
    console.error(`[file-lock] ${path.basename(filePath)} 操作失败:`, err)
    throw err
  })
  writeQueues.set(filePath, next)
  await next
  return result
}

// ── 终端跨平台 ──────────────────────────────────────────

/** 获取当前平台默认终端 shell */
export function getPlatformShell(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    return { cmd: 'cmd.exe', args: [] }
  }
  return { cmd: process.env.SHELL || '/bin/bash', args: [] }
}

/** 获取默认工作区根目录（优先级：环境变量 > 已存在的常见路径 > ~/claudespace） */
export function getWorkspaceRoot(): string {
  if (process.env.WORKSPACE_ROOT) return process.env.WORKSPACE_ROOT
  // 检查常见工作区路径，优先使用已存在的
  const homeWorkspace = path.join(os.homedir(), 'claudespace')
  if (fs.existsSync(homeWorkspace)) return homeWorkspace
  // Windows 上常见的非系统盘工作区
  if (process.platform === 'win32') {
    const candidates = ['E:/claudespace', 'D:/claudespace', 'C:/claudespace']
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c } catch { /* skip */ }
    }
  }
  return homeWorkspace
}
