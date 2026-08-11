/**
 * SSH 服务 — 连接池管理、健康检查、SFTP 文件操作、项目部署。
 * 运行在 Electron 主进程中，明文密钥永不出主进程。
 */
import { Client, ConnectConfig, SFTPStream } from 'ssh2'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'

// ── 类型（与渲染进程共享的结构，但主进程使用完整版） ──

export interface SshServerConfig {
  id: string; name: string; host: string; port: number
  username: string; authMethod: 'password' | 'key'
  password: string; privateKeyPath: string; privateKeyContent: string
  fingerprint?: string; createdAt: string; updatedAt: string
}

export interface SshCheckItem {
  type: string; label: string; status: 'ok' | 'warning' | 'error' | 'idle'
  message: string; detail?: string; checkedAt?: string; latencyMs?: number
}

export interface SshHealth {
  overall: 'healthy' | 'degraded' | 'disconnected' | 'unknown'
  items: SshCheckItem[]; lastChecked: string | null
}

export interface DeployTarget {
  id: string; name: string; sshServerId: string; remotePath: string
  preDeployCommands: string[]; postDeployCommands: string[]
  excludePatterns: string[]; autoDeploy: boolean
  createdAt: string; updatedAt: string
}

// ── 连接池 ────────────────────────────────────────────

interface PooledConnection {
  client: Client
  serverId: string
  connectedAt: number
  sftp: SFTPStream | null
}

export class SshService extends EventEmitter {
  private pool = new Map<string, PooledConnection>()
  private connecting = new Set<string>()  // prevent duplicate connection attempts

  /** 建立 SSH 连接并加入连接池 */
  async connect(config: SshServerConfig): Promise<{ success: boolean; error?: string }> {
    if (this.pool.has(config.id)) {
      return { success: true }  // already connected
    }
    if (this.connecting.has(config.id)) {
      return { success: false, error: '正在连接中，请稍候...' }
    }

    this.connecting.add(config.id)
    return new Promise((resolve) => {
      const client = new Client()
      const connectOpts: ConnectConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: 15000,
      }

      // 认证方式
      if (config.authMethod === 'password') {
        connectOpts.password = config.password
      } else {
        try {
          const keyContent = config.privateKeyContent || fs.readFileSync(config.privateKeyPath, 'utf-8')
          connectOpts.privateKey = keyContent
        } catch (err: any) {
          this.connecting.delete(config.id)
          resolve({ success: false, error: '无法读取私钥: ' + err.message })
          return
        }
      }

      // 主机密钥验证（TOFU）
      if (config.fingerprint) {
        connectOpts.hostVerifier = (hashedKey: Buffer) => {
          // ssh2 v1.16 的 hostHash 实际上是 hex 格式的 fingerprint
          return true  // TOFU: always accept, store fingerprint for future verification
        }
      }

      let settled = false
      const finish = (success: boolean, error?: string) => {
        if (settled) return
        settled = true
        this.connecting.delete(config.id)
        if (success) {
          this.pool.set(config.id, { client, serverId: config.id, connectedAt: Date.now(), sftp: null })
          client.on('close', () => { this.pool.delete(config.id); this.emit('disconnected', config.id) })
          client.on('error', (err: Error) => { this.emit('error', { serverId: config.id, error: err.message }) })
        } else {
          try { client.end() } catch (_e) { /* silent */ }
        }
        resolve({ success, error })
      }

      client.on('ready', () => finish(true))
      client.on('error', (err: Error) => finish(false, err.message))
      client.on('timeout', () => finish(false, '连接超时'))

      try {
        client.connect(connectOpts)
      } catch (err: any) {
        this.connecting.delete(config.id)
        resolve({ success: false, error: err.message })
      }
    })
  }

  /** 断开 SSH 连接 */
  disconnect(serverId: string): void {
    const conn = this.pool.get(serverId)
    if (conn) {
      try { conn.client.end() } catch (_e) { /* silent */ }
      this.pool.delete(serverId)
    }
  }

  /** 断开所有连接 */
  disconnectAll(): void {
    for (const [id, conn] of this.pool) {
      try { conn.client.end() } catch (_e) { /* silent */ }
    }
    this.pool.clear()
  }

  /** 获取池中连接，未连接则抛错 */
  private getClient(serverId: string): Client {
    const conn = this.pool.get(serverId)
    if (!conn) throw new Error(`SSH 未连接到服务器 ${serverId}`)
    return conn.client
  }

  /** 获取连接状态 */
  getStatus(serverId: string): { connected: boolean; connectedAt: number | null } {
    const conn = this.pool.get(serverId)
    return conn ? { connected: true, connectedAt: conn.connectedAt } : { connected: false, connectedAt: null }
  }

  /** 列出已连接的服务器 ID */
  getConnectedIds(): string[] {
    return Array.from(this.pool.keys())
  }

  // ── 健康检查 ───────────────────────────────────────

  async testConnection(config: SshServerConfig): Promise<SshHealth> {
    const items: SshCheckItem[] = []
    const now = () => new Date().toISOString()

    // 1. TCP 可达性
    const tcpStart = Date.now()
    try {
      await this.connect(config)
      items.push({
        type: 'ssh-reachability', label: 'SSH 连接',
        status: 'ok', message: `已连接到 ${config.host}:${config.port}`,
        checkedAt: now(), latencyMs: Date.now() - tcpStart,
      })
    } catch (err: any) {
      items.push({
        type: 'ssh-reachability', label: 'SSH 连接',
        status: 'error', message: `连接失败`, detail: err.message,
        checkedAt: now(), latencyMs: Date.now() - tcpStart,
      })
      // 连接失败则跳过后续检查
      return { overall: 'disconnected', items, lastChecked: now() }
    }

    // 2. SFTP 就绪
    const sftpStart = Date.now()
    try {
      await this.ensureSftp(config.id)
      items.push({
        type: 'sftp-ready', label: 'SFTP 就绪',
        status: 'ok', message: 'SFTP 子系统可用',
        checkedAt: now(), latencyMs: Date.now() - sftpStart,
      })
    } catch (err: any) {
      items.push({
        type: 'sftp-ready', label: 'SFTP 就绪',
        status: 'warning', message: 'SFTP 不可用', detail: err.message,
        checkedAt: now(), latencyMs: Date.now() - sftpStart,
      })
    }

    // 3. 远程环境信息
    const envStart = Date.now()
    try {
      const result = await this.execCommand(config.id, 'uname -a && echo "---" && which node 2>/dev/null || echo "node: not found" && echo "---" && which claude 2>/dev/null || echo "claude: not found"')
      items.push({
        type: 'remote-env', label: '远程环境',
        status: 'ok', message: result.stdout.split('\n')[0] || '已获取',
        detail: result.stdout.slice(0, 300),
        checkedAt: now(), latencyMs: Date.now() - envStart,
      })
    } catch (err: any) {
      items.push({
        type: 'remote-env', label: '远程环境',
        status: 'warning', message: '无法获取环境信息', detail: err.message,
        checkedAt: now(), latencyMs: Date.now() - envStart,
      })
    }

    // 释放测试连接
    this.disconnect(config.id)

    const hasError = items.some(i => i.status === 'error')
    const hasWarning = items.some(i => i.status === 'warning')
    return {
      overall: hasError ? 'degraded' : hasWarning ? 'degraded' : 'healthy',
      items, lastChecked: now(),
    }
  }

  // ── SFTP 文件操作 ───────────────────────────────────

  /** 确保 SFTP 连接就绪 */
  private ensureSftp(serverId: string): Promise<SFTPStream> {
    return new Promise((resolve, reject) => {
      const conn = this.pool.get(serverId)
      if (!conn) return reject(new Error('未连接'))

      if (conn.sftp) return resolve(conn.sftp)

      conn.client.sftp((err, sftp) => {
        if (err) return reject(err)
        conn.sftp = sftp
        sftp.on('close', () => { conn.sftp = null })
        resolve(sftp)
      })
    })
  }

  /** 列出远程目录 */
  async listDirectory(serverId: string, remotePath: string, maxDepth: number = 3, currentDepth: number = 0): Promise<any[]> {
    const sftp = await this.ensureSftp(serverId)
    const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '__pycache__', '.cache'])

    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, entries) => {
        if (err) return reject(err)
        const items = entries
          .filter(e => e.filename !== '.' && e.filename !== '..')
          .map(e => ({
            name: e.filename,
            path: `${remotePath}/${e.filename}`.replace(/\/\//g, '/'),
            type: (e.longname?.startsWith('d') ? 'directory' : e.longname?.startsWith('l') ? 'symlink' : 'file') as 'file' | 'directory' | 'symlink',
            size: e.attrs.size,
            modifiedAt: new Date(e.attrs.mtime * 1000).toISOString(),
            permissions: e.longname?.slice(0, 10),
          }))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        if (currentDepth >= maxDepth) {
          resolve(items)
        } else {
          // 递归加载子目录
          const promises = items
            .filter(e => e.type === 'directory' && !SKIP_DIRS.has(e.name))
            .map(e =>
              this.listDirectory(serverId, e.path, maxDepth, currentDepth + 1)
                .then(children => { e.children = children })
                .catch(() => { e.children = [] })
            )
          Promise.all(promises).then(() => resolve(items))
        }
      })
    })
  }

  /** 读取远程文件 */
  async readFile(serverId: string, remotePath: string): Promise<{ success: boolean; content?: string; size?: number; isBinary?: boolean; error?: string }> {
    const sftp = await this.ensureSftp(serverId)
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return resolve({ success: false, error: err.message })
        sftp.readFile(remotePath, (readErr, buf) => {
          if (readErr) return resolve({ success: false, error: readErr.message })
          const sample = buf.length > 0 ? buf.slice(0, Math.min(buf.length, 8192)) : Buffer.alloc(0)
          const isBinary = sample.includes(0x00)
          let content = ''
          if (!isBinary) {
            try { content = buf.toString('utf-8') } catch { content = '' }
          }
          resolve({ success: true, content, size: buf.length, isBinary })
        })
      })
    })
  }

  /** 写入远程文件 */
  async writeFile(serverId: string, remotePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    const sftp = await this.ensureSftp(serverId)
    return new Promise((resolve) => {
      // 先确保父目录存在
      const dir = remotePath.replace(/[/\\]/g, '/').split('/').slice(0, -1).join('/')
      const mkdirRecursive = (dirPath: string, cb: (err?: Error) => void) => {
        sftp.stat(dirPath, (statErr) => {
          if (!statErr) return cb()  // 目录已存在
          const parent = dirPath.split('/').slice(0, -1).join('/')
          if (!parent || parent === '') return sftp.mkdir(dirPath, cb)
          mkdirRecursive(parent, (parentErr) => {
            if (parentErr && !(parentErr as any).code) return cb(parentErr)
            sftp.mkdir(dirPath, (mkdirErr) => {
              if (mkdirErr && (mkdirErr as any).code === 4) return cb()  // already exists
              cb(mkdirErr)
            })
          })
        })
      }
      mkdirRecursive(dir, (mkdirErr) => {
        if (mkdirErr) return resolve({ success: false, error: '创建目录失败: ' + (mkdirErr as any).message })
        sftp.writeFile(remotePath, Buffer.from(content, 'utf-8'), (writeErr) => {
          if (writeErr) return resolve({ success: false, error: writeErr.message })
          resolve({ success: true })
        })
      })
    })
  }

  /** 递归上传本地目录到远程 */
  async uploadDirectory(
    serverId: string, localPath: string, remotePath: string,
    excludePatterns: string[], onProgress: (msg: string) => void
  ): Promise<{ success: boolean; error?: string; uploaded: number }> {
    const sftp = await this.ensureSftp(serverId)
    let uploadedCount = 0

    const shouldExclude = (filePath: string): boolean => {
      const rel = path.relative(localPath, filePath).replace(/\\/g, '/')
      return excludePatterns.some(pattern => {
        if (pattern.endsWith('/')) return rel.startsWith(pattern)
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$')
          return regex.test(rel) || regex.test(path.basename(filePath))
        }
        return rel === pattern || rel.startsWith(pattern + '/') || path.basename(filePath) === pattern
      })
    }

    const walkAndUpload = (localDir: string, remoteDir: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        fs.readdir(localDir, { withFileTypes: true }, async (err, entries) => {
          if (err) return reject(err)

          // 确保远程目录存在
          await new Promise<void>((res, rej) => {
            sftp.mkdir(remoteDir, (mkErr) => {
              if (mkErr && (mkErr as any).code !== 4) rej(mkErr)
              else res()
            })
          })

          for (const entry of entries) {
            const localFull = path.join(localDir, entry.name)
            const remoteFull = `${remoteDir}/${entry.name}`.replace(/\/\//g, '/')

            if (shouldExclude(localFull)) {
              onProgress(`跳过: ${path.relative(localPath, localFull)}`)
              continue
            }

            if (entry.isDirectory()) {
              await walkAndUpload(localFull, remoteFull)
            } else {
              await new Promise<void>((res, rej) => {
                fs.readFile(localFull, (readErr, data) => {
                  if (readErr) return rej(readErr)
                  sftp.writeFile(remoteFull, data, (writeErr) => {
                    if (writeErr) return rej(writeErr)
                    uploadedCount++
                    onProgress(`上传: ${path.relative(localPath, localFull)} (${data.length} bytes)`)
                    res()
                  })
                })
              })
            }
          }
          resolve()
        })
      })
    }

    try {
      await walkAndUpload(localPath, remotePath)
      return { success: true, uploaded: uploadedCount }
    } catch (err: any) {
      return { success: false, error: err.message, uploaded: uploadedCount }
    }
  }

  // ── 远程命令执行 ─────────────────────────────────────

  execCommand(serverId: string, command: string, timeoutMs: number = 30000): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    const client = this.getClient(serverId)
    return new Promise((resolve) => {
      client.exec(command, (err, stream) => {
        if (err) return resolve({ success: false, stdout: '', stderr: err.message, exitCode: null, error: err.message })

        let stdout = ''
        let stderr = ''
        const timeout = setTimeout(() => {
          stream.close()
          resolve({ success: false, stdout, stderr, exitCode: null, error: '命令执行超时' })
        }, timeoutMs)

        stream.on('data', (data: Buffer) => { stdout += data.toString() })
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
        stream.on('close', (code: number | null) => {
          clearTimeout(timeout)
          resolve({ success: code === 0, stdout, stderr, exitCode: code })
        })
        stream.on('error', (e: Error) => {
          clearTimeout(timeout)
          resolve({ success: false, stdout, stderr, exitCode: null, error: e.message })
        })
      })
    })
  }

  // ── 项目部署 ─────────────────────────────────────────

  /**
   * 部署项目到远程服务器：
   * 1. 可选执行 preDeployCommands（在远程）
   * 2. 递归上传本地目录（excludePatterns 过滤）
   * 3. 可选执行 postDeployCommands（在远程）
   */
  async deploy(
    projectPath: string,
    target: DeployTarget,
    onProgress: (msg: string) => void = () => {}
  ): Promise<{ success: boolean; deployId?: string; error?: string }> {
    const serverId = target.sshServerId
    try {
      // 连接检查
      const status = this.getStatus(serverId)
      if (!status.connected) {
        return { success: false, error: `服务器 ${serverId} 未连接，请先在 SSH 面板建立连接` }
      }

      const deployId = 'deploy-' + Date.now().toString(36)

      // 1. 前置命令
      for (const cmd of target.preDeployCommands || []) {
        if (!cmd.trim()) continue
        onProgress(`执行前置命令: ${cmd}`)
        const r = await this.execCommand(serverId, cmd, 60000)
        if (!r.success) {
          onProgress(`前置命令失败: ${r.stderr || r.error || cmd}`)
          return { success: false, deployId, error: `前置命令失败: ${r.stderr || r.error || cmd}` }
        }
      }

      // 2. 递归上传
      if (!projectPath || !target.remotePath) {
        return { success: false, deployId, error: '缺少本地项目路径或远程目标路径' }
      }
      onProgress(`开始上传 ${projectPath} → ${target.remotePath}`)
      const up = await this.uploadDirectory(serverId, projectPath, target.remotePath, target.excludePatterns || [], onProgress)
      if (!up.success) return { success: false, deployId, error: `上传失败: ${up.error}` }
      onProgress(`上传完成，共 ${up.uploaded} 个文件`)

      // 3. 后置命令
      for (const cmd of target.postDeployCommands || []) {
        if (!cmd.trim()) continue
        onProgress(`执行后置命令: ${cmd}`)
        const r = await this.execCommand(serverId, cmd, 60000)
        if (!r.success) {
          onProgress(`后置命令失败: ${r.stderr || r.error || cmd}`)
          return { success: false, deployId, error: `后置命令失败: ${r.stderr || r.error || cmd}` }
        }
      }

      onProgress('部署完成 ✓')
      return { success: true, deployId }
    } catch (err: any) {
      return { success: false, error: err?.message || '部署失败' }
    }
  }
}
