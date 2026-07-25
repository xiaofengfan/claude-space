/**
 * 图谱构建器 — 扫描项目目录、解析关键文件，构建知识图谱
 *
 * 数据来源：
 * 1. 目录树扫描 → directory/file 节点 + contains 边
 * 2. package.json / pom.xml → dependency 节点 + depends_on 边
 * 3. CLAUDE.md → tech/concept 节点 + describes/uses_tech 边
 * 4. 简单 import 分析 → imports 边（可选，按需开启）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GraphNode, GraphEdge, KnowledgeGraph, NodeType, EdgeType } from './types';

// ── 常量 ──────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.foundry', 'build', '.next',
  '__pycache__', '.idea', '.vscode', 'target', '.gradle', '.mvn',
  'bin', 'obj', '.cache', 'coverage',
]);

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte',
  '.java', '.kt', '.scala',
  '.py',
  '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift',
]);

const MAX_DEPTH = 4;
const MAX_FILES = 800;
const MAX_EDGES = 2000;

// ── 工具函数 ──────────────────────────────────────
function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function makeId(prefix: string, suffix: string): string {
  return `${prefix}:${suffix}`;
}

// ── 主构建函数 ────────────────────────────────────
export async function buildGraph(repoPath: string): Promise<KnowledgeGraph> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>(); // 去重

  function addEdge(source: string, target: string, type: EdgeType) {
    const id = `${source}-${type}-${target}`;
    if (edgeSet.has(id)) return;
    if (edges.length >= MAX_EDGES) return;
    edgeSet.add(id);
    edges.push({ id, source, target, type });
  }

  function addNode(node: GraphNode) {
    if (nodes.find(n => n.id === node.id)) return;
    nodes.push(node);
  }

  const projectName = path.basename(repoPath);
  const projectId = 'project:root';

  addNode({
    id: projectId,
    type: 'project',
    label: projectName,
    path: repoPath,
    properties: {},
  });

  // 1. 解析 CLAUDE.md → 技术栈 + 概念
  parseClaudeMd(repoPath, projectId, addNode, addEdge);

  // 2. 解析 package.json → 依赖
  parsePackageJson(repoPath, projectId, addNode, addEdge);

  // 3. 解析 pom.xml → Maven 依赖
  parsePomXml(repoPath, projectId, addNode, addEdge);

  // 4. 扫描目录树 → 目录/文件/模块节点
  let fileCount = 0;
  scanDirectory(repoPath, projectId, 0, addNode, addEdge, () => {
    fileCount++;
    return fileCount < MAX_FILES;
  });

  return {
    nodes,
    edges,
    builtAt: new Date().toISOString(),
  };
}

// ── CLAUDE.md 解析 ────────────────────────────────
function parseClaudeMd(
  repoPath: string,
  projectId: string,
  addNode: (n: GraphNode) => void,
  addEdge: (s: string, t: string, e: EdgeType) => void,
) {
  const content = safeRead(path.join(repoPath, 'CLAUDE.md'));
  if (!content) return;

  const lines = content.split('\n');
  let inTechSection = false;
  let inConceptSection = false;
  let conceptIdx = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测章节
    if (trimmed.startsWith('##')) {
      const section = trimmed.toLowerCase();
      inTechSection = section.includes('技术栈') || section.includes('tech stack');
      inConceptSection = section.includes('项目定位') || section.includes('overview') || section.includes('概念') || section.includes('architecture') || section.includes('架构');
      continue;
    }

    // 提取技术栈条目
    if (inTechSection && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
      const tech = trimmed.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (tech.length > 1 && tech.length < 80) {
        const techId = makeId('tech', tech.toLowerCase().replace(/\s+/g, '-'));
        addNode({
          id: techId,
          type: 'tech',
          label: tech,
          properties: { source: 'CLAUDE.md' },
        });
        addEdge(projectId, techId, 'uses_tech');
      }
    }

    // 提取概念
    if (inConceptSection && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
      const concept = trimmed.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (concept.length > 5 && concept.length < 120) {
        const conceptId = makeId('concept', `claude-${conceptIdx++}`);
        addNode({
          id: conceptId,
          type: 'concept',
          label: concept.slice(0, 60),
          properties: { source: 'CLAUDE.md', fullText: concept },
        });
        addEdge(projectId, conceptId, 'describes');
      }
    }
  }
}

// ── package.json 解析 ─────────────────────────────
function parsePackageJson(
  repoPath: string,
  projectId: string,
  addNode: (n: GraphNode) => void,
  addEdge: (s: string, t: string, e: EdgeType) => void,
) {
  const content = safeRead(path.join(repoPath, 'package.json'));
  if (!content) return;

  try {
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, version] of Object.entries(deps)) {
      const depId = makeId('dep', name);
      addNode({
        id: depId,
        type: 'dependency',
        label: name,
        properties: {
          version: version as string,
          manager: 'npm',
          dev: pkg.devDependencies?.[name] != null,
        },
      });
      addEdge(projectId, depId, 'depends_on');
    }
  } catch {}
}

// ── pom.xml 解析（Maven）─────────────────────────
function parsePomXml(
  repoPath: string,
  projectId: string,
  addNode: (n: GraphNode) => void,
  addEdge: (s: string, t: string, e: EdgeType) => void,
) {
  const content = safeRead(path.join(repoPath, 'pom.xml'));
  if (!content) return;

  // 简单正则提取 <dependency> 块
  const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]*)<\/version>)?/g;
  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const [, groupId, artifactId, version] = match;
    const name = `${groupId}:${artifactId}`;
    const depId = makeId('dep', name);
    addNode({
      id: depId,
      type: 'dependency',
      label: artifactId,
      properties: {
        groupId,
        artifactId,
        version: version || '',
        manager: 'maven',
      },
    });
    addEdge(projectId, depId, 'depends_on');
  }
}

// ── 目录树扫描 ────────────────────────────────────
function scanDirectory(
  dirPath: string,
  parentId: string,
  depth: number,
  addNode: (n: GraphNode) => void,
  addEdge: (s: string, t: string, e: EdgeType) => void,
  shouldContinue: () => boolean,
) {
  if (depth >= MAX_DEPTH || !shouldContinue()) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  // 按目录在前、文件在后排序
  const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));
  const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));

  // 先处理子目录
  for (const dir of dirs) {
    const fullPath = path.join(dirPath, dir.name);
    const relPath = path.relative(dirPath, fullPath);
    const dirId = makeId('dir', fullPath.replace(/\\/g, '/'));

    // 检测是否是子模块（含 package.json）
    const isModule = fs.existsSync(path.join(fullPath, 'package.json'));
    const nodeType: NodeType = isModule ? 'module' : 'directory';

    addNode({
      id: dirId,
      type: nodeType,
      label: dir.name,
      path: fullPath,
      properties: { depth, isModule },
    });
    addEdge(parentId, dirId, 'contains');

    // 递归扫描子目录
    scanDirectory(fullPath, dirId, depth + 1, addNode, addEdge, shouldContinue);
  }

  // 再处理文件
  for (const file of files) {
    if (!shouldContinue()) break;

    const ext = path.extname(file.name).toLowerCase();
    const isSource = SOURCE_EXTS.has(ext);
    const isConfig = ['.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.properties', '.ini', '.conf', '.md', '.markdown', '.sql'].includes(ext);

    // 跳过非源码和非配置文件
    if (!isSource && !isConfig) continue;

    const fullPath = path.join(dirPath, file.name);
    const fileId = makeId('file', fullPath.replace(/\\/g, '/'));

    // 修复：源代码用 'file' 类型，配置/文档也用 'file' 但通过 properties.isConfig/isDoc 标记
    const nodeType: NodeType = 'file';

    const stats = safeStat(fullPath);

    addNode({
      id: fileId,
      type: nodeType,
      label: file.name,
      path: fullPath,
      properties: {
        ext,
        language: extToLanguage(ext),
        size: stats?.size || 0,
        lines: stats ? countLines(fullPath) : 0,
        isSource,
        isConfig,
        isDoc: ['.md', '.markdown', '.txt', '.rst'].includes(ext),
      },
    });
    addEdge(parentId, fileId, 'contains');
  }
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function countLines(filePath: string): number {
  const content = safeRead(filePath);
  if (!content) return 0;
  return content.split('\n').length;
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TSX',
    '.js': 'JavaScript', '.jsx': 'JSX',
    '.vue': 'Vue', '.svelte': 'Svelte',
    '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
    '.py': 'Python',
    '.go': 'Go', '.rs': 'Rust',
    '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header', '.hpp': 'C++ Header',
    '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
    '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
    '.toml': 'TOML', '.xml': 'XML', '.md': 'Markdown',
  };
  return map[ext] || 'Unknown';
}
