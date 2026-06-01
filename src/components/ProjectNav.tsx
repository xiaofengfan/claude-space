import { ProjectInfo } from '../types/project'

export function ProjectNav({
  project,
  leftView,
  onLeftViewChange,
  onGitClick,
}: {
  project: ProjectInfo | null
  leftView: string
  onLeftViewChange: (view: string) => void
  onGitClick?: () => void
}) {
  if (!project) return null

  return (
    <div className="project-nav">
      <div className="project-nav-left">
        <span className="project-nav-icon">📂</span>
        <div className="project-nav-info">
          <span className="project-nav-name">{project.name}</span>
          {project.techStack && (
            <span className="project-nav-tech">{project.techStack}</span>
          )}
          <span className="project-nav-path" title={project.path}>
            {project.path.length > 40
              ? '...' + project.path.slice(-37)
              : project.path}
          </span>
        </div>
      </div>
      <div className="project-nav-actions">
        <button className="nav-action-btn" onClick={onGitClick} title="Git 版本管理">⎇ Git</button>
        <button className="nav-action-btn" disabled title="即将推出">▶ 运行</button>
        <button className="nav-action-btn" disabled title="即将推出">🐛 调试</button>
      </div>
    </div>
  )
}
