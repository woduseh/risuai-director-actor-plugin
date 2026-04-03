export function createPluginBanner({
  name,
  displayName,
  version,
  description
}) {
  const lines = [
    `//@name ${name}`,
    `//@display-name ${displayName}`,
    '//@api 3.0',
    `//@version ${version}`
  ]

  if (description) {
    lines.push(`//@description ${description}`)
  }

  lines.push('')
  return lines.join('\n')
}
