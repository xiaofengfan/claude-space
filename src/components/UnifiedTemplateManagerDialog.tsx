/**
 * 统一模板管理对话框（融合版 v3）
 *
 * 改造历史：
 * - v1：顶层"简单模式/高级模式"切换，分别渲染 TemplateManagerDialog 和 TemplateBrowser
 * - v2：融合版，直接渲染 TemplateBrowser
 * - v3（当前）：增加子模块 Tab
 *   ├── 工作流模板（TemplateBrowser）
 *   └── 图谱分析模板（GraphPromptManager）
 */

import { useState } from 'react';
import { TemplateBrowser } from './orchestrator/TemplateBrowser';
import { GraphPromptManager } from './knowledge-graph/GraphPromptManager';

type SubModule = 'workflow' | 'graph';

interface Props {
  theme: 'dark' | 'light';
  activeProjectPath?: string;
  onClose: () => void;
  /** 创建编排后的回调（跳转到编排工坊）*/
  onOrchestrationCreated?: () => void;
}

export function UnifiedTemplateManagerDialog({ theme, activeProjectPath, onClose, onOrchestrationCreated }: Props) {
  const [maximized, setMaximized] = useState(false);
  const [subModule, setSubModule] = useState<SubModule>('workflow');

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`dialog unified-template-dialog ${maximized ? 'maximized' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 顶部：标题 + 窗口按钮 ──────────────── */}
        <div className="unified-template-header">
          <div className="unified-template-title">
            <h2>📋 模板管理</h2>
            <p className="unified-template-subtitle">
              统一管理工作流模板和图谱分析模板 · 支持自定义与项目级持久化
            </p>
          </div>
          <div className="unified-template-window-btns">
            <button
              className="dialog-window-btn"
              onClick={() => setMaximized(m => !m)}
              title={maximized ? '还原' : '最大化'}
              type="button"
            >
              {maximized ? '🗗' : '🗖'}
            </button>
            <button className="dialog-window-btn dialog-close-btn" onClick={onClose} title="关闭" type="button">✕</button>
          </div>
        </div>

        {/* ── 子模块 Tab 切换条 ──────────────────── */}
        <div className="unified-template-tabs">
          <button
            className={`unified-template-tab ${subModule === 'workflow' ? 'active' : ''}`}
            onClick={() => setSubModule('workflow')}
            type="button"
          >
            🔧 工作流模板
          </button>
          <button
            className={`unified-template-tab ${subModule === 'graph' ? 'active' : ''}`}
            onClick={() => setSubModule('graph')}
            type="button"
          >
            🕸️ 图谱分析模板
          </button>
        </div>

        {/* ── 模式说明条 ────────────────────────────────── */}
        <div className="unified-template-info-bar">
          <span className="unified-info-icon">{subModule === 'workflow' ? '📦' : '🕸️'}</span>
          <span className="unified-info-text">
            {subModule === 'workflow' ? (
              <>
                <strong>工作流模板：</strong>
                所有模板统一为 DAG 数据模型，左侧选择模板，右侧编辑器同时支持阶段管理（增删改查、上下移动）和高级配置（重试策略、AI 顾问、条件分支、参数化）。内置模板可直接编辑后应用到项目，也可另存为自定义模板。
                <span className="unified-info-tip">💡 应用到项目后，在左侧栏「AI 编排工坊」查看运行状态</span>
              </>
            ) : (
              <>
                <strong>图谱分析模板：</strong>
                管理 AI 分析项目时使用的 Prompt 模板。内置模板（项目全景、模块分解、数据流、API 路由）只读但可"另存为自定义"。自定义模板可自由编辑、增删，并按项目持久化保存。
                <span className="unified-info-tip">💡 自定义模板在「项目图谱」的 🤖 AI 分析对话框中可直接选用</span>
              </>
            )}
          </span>
        </div>

        {/* ── 内容区：按子模块切换 ────────────────── */}
        <div className="unified-template-body">
          {subModule === 'workflow' ? (
            <div className="unified-advanced-wrap">
              <TemplateBrowser
                repoPath={activeProjectPath || ''}
                onOrchestrationCreated={onOrchestrationCreated}
              />
            </div>
          ) : (
            <div className="unified-advanced-wrap">
              {activeProjectPath ? (
                <GraphPromptManager theme={theme} projectPath={activeProjectPath} />
              ) : (
                <div className="unified-template-empty">
                  <div className="unified-template-empty-icon">📂</div>
                  <div className="unified-template-empty-text">
                    请先选择一个项目，图谱分析模板按项目持久化保存
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
