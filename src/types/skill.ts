export interface SkillManifest {
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string
  icon: string
  level: 'project' | 'global'
  enabled: boolean
  created: string
  updated: string
  fileName: string
  filePath: string
}

export interface SkillScanResult extends SkillManifest {
  content: string
  sourceName?: string
  sourceUrl?: string
}

export interface MarketSource {
  name: string
  url: string
  enabled: boolean
  autoScan: boolean
}

export interface SkillMarketplaceItem {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  downloads: number
  rating: number
  tags: string[]
  url: string
}
