/**
 * 工作流模板浏览器（融合版 v3）
 *
 * 布局：
 * - 列表视图（默认）：所有模板按 kind 分组，卡片标记"应用中"状态，点击进入编辑
 * - 编辑视图：返回按钮 + TemplateEditor（顶部基本信息/左阶段列表/中阶段详情/右流程图）
 */

import { useState, useMemo, useEffect } from 'react';
import type { Template, IpcResponse, Orchestration } from './types';
import { templateToWorkflowDetail } from './types';
import {
  backendTemplateToUnified, loadCustomTemplates, saveCustomTemplates,
  createEmptyTemplate, type UnifiedTemplate,
} from './unifiedTemplate';
import { TemplateEditor } from './TemplateEditor';

interface Props {
  repoPath: string;
  /** 创建编排成功后的回调（用于跳转到编排工坊） */
  onOrchestrationCreated?: () => void;
  /** @deprecated 兼容旧接口，内置模板创建编排时调用。如提供则用此回调，否则自动调 orchestrator.create */
  onCreateOrchestration?: (templateId: string, goal: string, autoApprove: boolean, testCommand?: string) => Promise<void>;
  creating?: boolean;
}

const TEMPLATE_KIND_ICON: Record<Template['kind'], string> = {
  greenfield: '🌱',
  refactor: '♻️',
  migration: '🚚',
  upgrade: '⬆️',
  hotfix: '🚑',
  custom: '📦',
};

const TEMPLATE_KIND_LABEL: Record<Template['kind'], string> = {
  greenfield: '全新项目',
  refactor: '重构',
  migration: '迁移',
  upgrade: '升级',
  hotfix: '紧急修复',
  custom: '自定义',
};

const KIND_ORDER: Template['kind'][] = ['greenfield', 'refactor', 'migration', 'upgrade', 'hotfix', 'custom'];

export function TemplateBrowser({ repoPath, onOrchestrationCreated, onCreateOrchestration, creating }: Props) {
  const [builtinTemplates, setBuiltinTemplates] = useState<Template[]>([]);
  const [customTemplates, setCustomTemplates] = useState<UnifiedTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  // 内置模板的编辑态（仅存内存，不覆盖后端原版）
  const [builtinEdits, setBuiltinEdits] = useState<Record<string, UnifiedTemplate>>({});
  // 视图状态：list=模板列表 / edit=模板编辑
  const [view, setView] = useState<'list' | 'edit'>('list');
  // 运行中的编排列表（用于判断模板"应用中"）
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([]);

  // 加载模板列表 + 编排列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, orchRes]: [IpcResponse<Template[]>, IpcResponse<Orchestration[]>] = await Promise.all([
          window.orchestrator.templates(),
          window.orchestrator.list().catch(() => ({ ok: true, data: [] as Orchestration[] })),
        ]);
        if (cancelled) return;
        if (tplRes.ok && tplRes.data) {
          setBuiltinTemplates(tplRes.data);
          const custom = loadCustomTemplates();
          setCustomTemplates(custom);
          if (orchRes.ok && orchRes.data) setOrchestrations(orchRes.data);
        } else {
          setError(tplRes.error?.message || '加载模板失败');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'orchestrator API 不可用');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 把内置模板转为 UnifiedTemplate 形式
  const builtinUnified = useMemo(() => builtinTemplates.map(backendTemplateToUnified), [builtinTemplates]);

  // 合并所有模板
  const allUnified = useMemo(() => [...builtinUnified, ...customTemplates], [builtinUnified, customTemplates]);

  // 按 kind 分组
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, UnifiedTemplate[]> = {};
    for (const t of allUnified) {
      const kind = t.kind || 'custom';
      if (!groups[kind]) groups[kind] = [];
      groups[kind].push(t);
    }
    return groups;
  }, [allUnified]);

  // 正在应用中的模板 ID 集合（编排状态为 running/pending/ready/blocked 等）
  const inUseTemplateIds = useMemo(() => {
    const activeStatuses = ['running', 'pending', 'ready', 'blocked'];
    return new Set(orchestrations
      .filter(o => activeStatuses.includes(o.status))
      .map(o => o.templateId));
  }, [orchestrations]);

  // 选中模板（内置模板若有编辑则用编辑后版本）
  const rawSelected = allUnified.find(t => t.id === selectedId) || null;
  const selectedTemplate = rawSelected
    ? (rawSelected.builtin ? (builtinEdits[rawSelected.id] || rawSelected) : rawSelected)
    : null;
  const isBuiltin = rawSelected?.builtin === true;

  // ── 自定义模板操作 ──
  const handleNewTemplate = () => {
    const t = createEmptyTemplate();
    const next = [...customTemplates, t];
    setCustomTemplates(next);
    saveCustomTemplates(next);
    setSelectedId(t.id);
    setView('edit');
  };

  const handleSaveTemplate = async (t: UnifiedTemplate) => {
    setSaving(true);
    try {
      const next = customTemplates.some(x => x.id === t.id)
        ? customTemplates.map(x => x.id === t.id ? t : x)
        : [...customTemplates, t];
      setCustomTemplates(next);
      saveCustomTemplates(next);
      return '✓ 模板已保存';
    } catch (e: any) {
      console.error('保存模板失败:', e);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = (id: string) => {
    if (!confirm('删除此自定义模板？内置模板不可删除。')) return;
    const next = customTemplates.filter(t => t.id !== id);
    setCustomTemplates(next);
    saveCustomTemplates(next);
    if (selectedId === id) {
      setSelectedId(null);
      setView('list');
    }
  };

  // 应用到项目
  const handleApplyToProject = async (templateId: string, goal: string, autoApprove: boolean, testCommand?: string) => {
    setApplying(true);
    try {
      if (!repoPath) {
        alert('请先选择项目');
        return;
      }
      let res;
      const custom = customTemplates.find(t => t.id === templateId);
      if (custom) {
        res = await window.orchestrator.createWithTemplate({
          template: custom as any,
          goal, autoApprove, testCommand,
          repoPath,
        });
      } else {
        const builtinEdit = builtinEdits[templateId];
        if (builtinEdit) {
          res = await window.orchestrator.createWithTemplate({
            template: builtinEdit as any,
            goal, autoApprove, testCommand,
            repoPath,
          });
        } else if (onCreateOrchestration) {
          await onCreateOrchestration(templateId, goal, autoApprove, testCommand);
          onOrchestrationCreated?.();
          return;
        } else {
          res = await window.orchestrator.create({
            repoPath, templateId, goal, autoApprove, testCommand,
          });
        }
      }
      if (!res) return;
      if (!res.ok) throw new Error(res.error?.message || '创建编排失败');

      // 自动启动编排
      const orchestrationId = (res.data as any)?.id;
      if (orchestrationId) {
        try {
          await window.orchestrator.start(orchestrationId);
        } catch (e) {
          console.warn('自动启动编排失败（不影响创建）:', e);
        }
      }
      onOrchestrationCreated?.();
    } catch (e: any) {
      alert('创建编排失败：' + (e?.message || e));
    } finally {
      setApplying(false);
    }
  };

  // 内置模板编辑（仅存内存）
  const handleBuiltinChange = (t: UnifiedTemplate) => {
    setBuiltinEdits(prev => ({ ...prev, [t.id]: t }));
  };

  // 内置模板另存为自定义模板
  const handleSaveBuiltinAsCustom = (t: UnifiedTemplate): string => {
    const cloned: UnifiedTemplate = {
      ...t,
      id: 'custom-' + Date.now().toString(36),
      name: t.name + ' (副本)',
      builtin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = [...customTemplates, cloned];
    setCustomTemplates(next);
    saveCustomTemplates(next);
    setSelectedId(cloned.id);
    return `✓ 已另存为「${cloned.name}」`;
  };

  // 自定义模板变化处理（实时编辑）
  const handleTemplateChange = (t: UnifiedTemplate) => {
    setCustomTemplates(prev => prev.some(x => x.id === t.id)
      ? prev.map(x => x.id === t.id ? t : x)
      : [...prev, t]);
  };

  // 点击模板卡片 → 进入编辑视图
  const handleOpenTemplate = (id: string) => {
    setSelectedId(id);
    setView('edit');
  };

  // 返回列表
  const handleBackToList = () => {
    setView('list');
    setSelectedId(null);
  };

  // ── 列表视图 ──
  if (view === 'list' || !selectedTemplate) {
    return (
      <div className="orch-tpl-list-view">
        <div className="orch-tpl-list-head">
          <h3>📋 工作流模板</h3>
          <p className="orch-browser-hint">
            共 {allUnified.length} 个模板（{builtinUnified.length} 内置 + {customTemplates.length} 自定义）· 点击模板进入编辑
          </p>
          <button className="orch-new-template-btn" onClick={handleNewTemplate} type="button">
            ➕ 新建自定义模板
          </button>
        </div>

        {loading && <div className="orch-hint">加载中…</div>}
        {error && <div className="orch-error">⚠️ {error}</div>}

        <div className="orch-tpl-list-body">
          {KIND_ORDER.map(kind => {
            const list = groupedTemplates[kind] || [];
            if (list.length === 0) return null;
            return (
              <div key={kind} className="orch-template-group">
                <div className="orch-template-group-head">
                  <span className="orch-template-group-icon">{TEMPLATE_KIND_ICON[kind]}</span>
                  <span className="orch-template-group-label">{TEMPLATE_KIND_LABEL[kind]}</span>
                  <span className="orch-template-group-count">({list.length})</span>
                </div>
                <div className="orch-tpl-card-grid">
                  {list.map(t => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      inUse={inUseTemplateIds.has(t.id)}
                      onClick={() => handleOpenTemplate(t.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 编辑视图 ──
  return (
    <div className="orch-tpl-edit-view">
      <TemplateEditor
        template={selectedTemplate}
        onChange={isBuiltin ? handleBuiltinChange : handleTemplateChange}
        onSave={isBuiltin
          ? () => handleSaveBuiltinAsCustom(selectedTemplate)
          : () => handleSaveTemplate(selectedTemplate)}
        onDelete={isBuiltin ? undefined : () => handleDeleteTemplate(selectedTemplate.id)}
        onApplyToProject={(goal, autoApprove, testCmd) =>
          handleApplyToProject(rawSelected!.id, goal, autoApprove, testCmd)
        }
        onBack={handleBackToList}
        repoPath={repoPath}
        readOnly={false}
        saving={saving}
        applying={applying}
        isBuiltin={isBuiltin}
      />
    </div>
  );
}

// ── 模板卡片 ─────────────────────────────────────────────

function TemplateCard({ template, inUse, onClick }: {
  template: UnifiedTemplate;
  inUse: boolean;
  onClick: () => void;
}) {
  const wf = useMemo(() => {
    const t: any = { ...template, kind: template.kind };
    return templateToWorkflowDetail(t);
  }, [template]);

  const hasAdvanced = !!(template.params?.length || template.edges?.length || template.maxIterations ||
    template.tasks.some(t => t.retryPolicy || t.advisors?.length || t.kind === 'switch' || t.kind === 'harness-call'));

  return (
    <div
      className={`orch-browser-card ${template.builtin ? 'builtin' : 'custom'}`}
      onClick={onClick}
    >
      <div className="orch-browser-card-title">
        <span className="orch-browser-card-icon">{template.icon}</span>
        <span className="orch-browser-card-name">{template.name}</span>
        {template.builtin ? (
          <span className="orch-browser-card-tag builtin">内置</span>
        ) : (
          <span className="orch-browser-card-tag custom">自定义</span>
        )}
        {inUse && <span className="orch-browser-card-tag inuse" title="有项目正在使用此模板">● 应用中</span>}
      </div>
      {template.description && <div className="orch-browser-card-desc">{template.description}</div>}
      <div className="orch-browser-card-meta">
        <span>📊 {wf.nodes.length} 节点</span>
        <span>·</span>
        <span>🔗 {wf.edges.length} 边</span>
        {hasAdvanced && <span>·</span>}
        {hasAdvanced && <span className="orch-tag-adv">⚡ 增强</span>}
      </div>
    </div>
  );
}
