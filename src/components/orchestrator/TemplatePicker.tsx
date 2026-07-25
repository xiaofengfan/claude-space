/**
 * 模板选择器
 *
 * 显示 5 个内置模板卡片，用户选择目标模板并填写 goal 后触发 onCreate
 */

import { useState, useEffect } from 'react';
import type { Template, IpcResponse } from './types';

interface Props {
  /** 当前选中的模板 id（受控） */
  selectedId?: string;
  /** 选择模板回调 */
  onSelect: (template: Template) => void;
  /** 项目目标 */
  goal: string;
  /** 目标变更回调 */
  onGoalChange: (goal: string) => void;
  /** 是否启用自动审批 */
  autoApprove: boolean;
  /** 自动审批变更回调 */
  onAutoApproveChange: (v: boolean) => void;
  /** 测试命令（可选） */
  testCommand?: string;
  /** 测试命令变更回调 */
  onTestCommandChange?: (v: string) => void;
  /** 创建编排回调 */
  onCreate: () => void;
  /** 是否正在创建 */
  creating?: boolean;
  /** 禁用创建（已有编排在运行） */
  disabled?: boolean;
}

export function TemplatePicker({
  selectedId,
  onSelect,
  goal,
  onGoalChange,
  autoApprove,
  onAutoApproveChange,
  testCommand,
  onTestCommandChange,
  onCreate,
  creating,
  disabled,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res: IpcResponse<Template[]> = await window.orchestrator.templates();
        if (cancelled) return;
        if (res.ok && res.data) {
          setTemplates(res.data);
          // 默认选中第一个
          if (!selectedId && res.data.length > 0) {
            onSelect(res.data[0]);
          }
        } else {
          setError(res.error?.message || '加载模板失败');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'orchestrator API 不可用');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCreate = !!selectedId && goal.trim().length > 0 && !creating && !disabled;

  return (
    <div className="orch-template-picker">
      <div className="orch-section-title">选择编排模板</div>

      {loading && <div className="orch-hint">正在加载模板...</div>}
      {error && <div className="orch-error">⚠️ {error}</div>}

      {!loading && !error && (
        <div className="orch-template-grid">
          {templates.map((t) => (
            <button
              key={t.id}
              className={`orch-template-card${selectedId === t.id ? ' active' : ''}`}
              onClick={() => onSelect(t)}
              type="button"
            >
              <div className="orch-template-card-header">
                <span className="orch-template-icon">{TEMPLATE_KIND_ICON[t.kind]}</span>
                <span className="orch-template-name">{t.name}</span>
              </div>
              <div className="orch-template-desc">{t.description}</div>
              <div className="orch-template-meta">
                <span>📊 {t.tasks.length} 节点</span>
                <span>·</span>
                <span>{TEMPLATE_KIND_LABEL[t.kind]}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="orch-form-row">
        <label className="orch-form-label">项目目标</label>
        <textarea
          className="orch-form-textarea"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          placeholder="例如：将项目从 Spring MVC 迁移到 Spring Boot 3.x"
          rows={3}
          disabled={disabled}
        />
      </div>

      <div className="orch-form-row">
        <label className="orch-form-checkbox">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => onAutoApproveChange(e.target.checked)}
            disabled={disabled}
          />
          <span>自动通过人工审批（autoApprove）</span>
        </label>
      </div>

      {onTestCommandChange && (
        <div className="orch-form-row">
          <label className="orch-form-label">测试命令（可选，留空则跳过测试门禁）</label>
          <input
            className="orch-form-input"
            type="text"
            value={testCommand || ''}
            onChange={(e) => onTestCommandChange(e.target.value)}
            placeholder="如：npm test 或 mvn test"
            disabled={disabled}
          />
        </div>
      )}

      <button
        className="orch-btn orch-btn-primary"
        onClick={onCreate}
        disabled={!canCreate}
        type="button"
      >
        {creating ? '创建中...' : '🚀 创建编排'}
      </button>
    </div>
  );
}

// ── 常量映射 ──────────────────────────────────────────
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
