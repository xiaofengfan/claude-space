/**
 * IPC 通道定义
 *
 * 所有通道名加 orchestrator:v1: 前缀，避免与现有通道冲突
 */

export const ORCH_CHANNELS = {
  // 任务管理
  CREATE:        'orchestrator:v1:create',
  START:         'orchestrator:v1:start',
  PAUSE:         'orchestrator:v1:pause',
  RESUME:        'orchestrator:v1:resume',
  STOP:          'orchestrator:v1:stop',
  STATUS:        'orchestrator:v1:status',
  LIST:          'orchestrator:v1:list',
  // 审批
  APPROVE:       'orchestrator:v1:approve',
  REJECT:        'orchestrator:v1:reject',
  TAKEOVER:      'orchestrator:v1:takeover',
  // 查询
  TASK_DETAIL:   'orchestrator:v1:task-detail',
  TASK_LIST:     'orchestrator:v1:task-list',
  ARTIFACT_READ: 'orchestrator:v1:artifact-read',
  TEMPLATES:     'orchestrator:v1:templates',
  // 维护
  CLEANUP:       'orchestrator:v1:cleanup',
  HEALTH_CHECK:  'orchestrator:v1:health-check',
  CREATE_WITH_TEMPLATE: 'orchestrator:v1:create-with-template',
  UPDATE_TASK_IO: 'orchestrator:v1:update-task-io',
} as const;

export const ORCH_EVENTS = {
  STATUS_CHANGE:  'orchestrator:v1:event:status',
  TASK_STARTED:   'orchestrator:v1:event:task-started',
  TASK_COMPLETED: 'orchestrator:v1:event:task-completed',
  TASK_LOG:       'orchestrator:v1:event:task-log',
  AWAIT_APPROVAL: 'orchestrator:v1:event:approval',
  LOG:            'orchestrator:v1:event:log',
} as const;
