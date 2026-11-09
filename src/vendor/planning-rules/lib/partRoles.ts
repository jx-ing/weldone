import type { Part, PartRole, Weld } from '@/types/weld'
import type { MergeGroup } from './weldMerge'

export function partRoleLabel(role: PartRole): string {
  return role.status !== '待确认' ? role.type : role.type === '补板' ? '补板（类别待确认）' : '水密补板候选'
}

export function isRecognizedRolePart(part: Part | undefined): boolean {
  const role = part?.partRole
  return !!role && ['补板', '水密补板'].includes(role.type)
    && ['用户确认', '源几何识别', '待确认'].includes(role.status)
}

export function hasPartRoles(parts: readonly Part[]): boolean {
  return parts.some((part) => part.partRole && ['补板', '水密补板'].includes(part.partRole.type))
}

export function partMatchesSearch(part: Part | undefined, query: string): boolean {
  if (!part) return false
  const q = query.trim().toLowerCase()
  return !q || [part.id, part.name, part.sourceName, part.assemblyName, ...(part.assemblyPath ?? []),
    part.partRole ? partRoleLabel(part.partRole) : undefined]
    .some((value) => value?.toLowerCase().includes(q))
}

export function weldMatchesSearch(weld: Weld, query: string, parts: ReadonlyMap<string, Part>): boolean {
  const q = query.trim().toLowerCase()
  return !q || weld.id.toLowerCase().includes(q) || weld.jointType.toLowerCase().includes(q)
    || weld.segments.some((segment) => q === `段${segment.index}`)
    || partMatchesSearch(parts.get(weld.mainPartId), q) || partMatchesSearch(parts.get(weld.subPartId), q)
}

export function mergeMatchesSearch(group: Pick<MergeGroup, 'id' | 'members'>, query: string,
  welds: ReadonlyMap<string, Weld>, parts: ReadonlyMap<string, Part>): boolean {
  const q = query.trim().toLowerCase()
  return !q || group.id.toLowerCase().includes(q) || group.members.some((member) => {
    const weld = welds.get(member.weldId)
    return member.id.toLowerCase().includes(q) || !!weld && weldMatchesSearch(weld, q, parts)
  })
}

export function recognizedRoleWeldIds(welds: readonly Weld[], parts: readonly Part[]): Set<string> {
  const roleParts = new Set(parts.filter(isRecognizedRolePart).map((part) => part.id))
  return new Set(welds.filter((weld) => roleParts.has(weld.mainPartId) || roleParts.has(weld.subPartId)).map((weld) => weld.id))
}

export function shouldHideShortWeld(length: number, weldId: string, keepRoleShortWelds: boolean,
  roleWeldIds: ReadonlySet<string>, minimumLength = 50): boolean {
  return length < minimumLength && !(keepRoleShortWelds && roleWeldIds.has(weldId))
}

export function shouldHideShortGroup(group: Pick<MergeGroup, 'totalLength' | 'members'>,
  keepRoleShortWelds: boolean, roleWeldIds: ReadonlySet<string>, minimumLength = 50): boolean {
  return group.totalLength < minimumLength && !(keepRoleShortWelds && group.members.length > 0
    && group.members.some((member) => roleWeldIds.has(member.weldId)))
}
