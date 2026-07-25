/**
 * Knowledge Graph preload — 暴露 window.knowledgeGraph API 给渲染进程
 */

import { contextBridge, ipcRenderer } from 'electron';
import { KG_CHANNELS } from './types';
import type {
  KnowledgeGraph,
  QueryFilter,
  AnalysisResult,
  IpcResponse,
} from './types';

const api = {
  /** 构建/刷新图谱 */
  build: (repoPath: string): Promise<IpcResponse<{ builtAt: string; nodeCount: number; edgeCount: number }>> =>
    ipcRenderer.invoke(KG_CHANNELS.BUILD, repoPath),

  /** 获取完整图谱 */
  get: (repoPath: string): Promise<IpcResponse<KnowledgeGraph>> =>
    ipcRenderer.invoke(KG_CHANNELS.GET, repoPath),

  /** 按类型/关键词查询 */
  query: (repoPath: string, filter: QueryFilter): Promise<IpcResponse<{ nodes: any[]; edges: any[] }>> =>
    ipcRenderer.invoke(KG_CHANNELS.QUERY, repoPath, filter),

  /** 统计分析 */
  analyze: (repoPath: string): Promise<IpcResponse<AnalysisResult>> =>
    ipcRenderer.invoke(KG_CHANNELS.ANALYZE, repoPath),

  /** 合并 AI 分析结果到图谱缓存 */
  mergeAi: (repoPath: string, aiData: { entities: any[]; relations: any[] }): Promise<IpcResponse<{ addedNodes: number; addedEdges: number; totalNodes: number; totalEdges: number }>> =>
    ipcRenderer.invoke(KG_CHANNELS.MERGE_AI, repoPath, aiData),
};

export function exposeKnowledgeGraphApi(): void {
  contextBridge.exposeInMainWorld('knowledgeGraph', api);
  console.log('[knowledge-graph:preload] 已暴露 window.knowledgeGraph API');
}
