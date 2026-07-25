/**
 * 自定义错误类型
 */

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class WorktreeError extends OrchestratorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'WORKTREE_ERROR', options);
  }
}

export class GateError extends OrchestratorError {
  constructor(
    message: string,
    public readonly gateType: 'test' | 'review',
    options?: ErrorOptions,
  ) {
    super(message, 'GATE_ERROR', options);
  }
}

export class PreflightError extends OrchestratorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PREFLIGHT_ERROR', options);
  }
}

export class DagError extends OrchestratorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'DAG_ERROR', options);
  }
}

export class StoreError extends OrchestratorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'STORE_ERROR', options);
  }
}

export class TimeoutError extends OrchestratorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'TIMEOUT', options);
  }
}
