export interface PluginBannerOptions {
  name: string
  displayName: string
  version: string
  description?: string
}

export function createPluginBanner(options: PluginBannerOptions): string
