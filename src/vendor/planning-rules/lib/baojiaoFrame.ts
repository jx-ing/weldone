/** 包角依据端部特征所属板件；所有方向都在当前模型坐标中求解。 */
import * as THREE from 'three'
import type { Weld } from '@/types/weld'

export type BaojiaoWrapSide = 'main' | 'sub'
type EndpointNormals = { tangent: THREE.Vector3; nMain: THREE.Vector3; nSub: THREE.Vector3 }

/** 缺少旧数据关联面时沿用副板；显式主板特征不能被副板覆盖。 */
export function endpointWrapSide(weld: Weld, which: 'start' | 'end'): BaojiaoWrapSide {
  const feature = weld.properties[which === 'start' ? '起点特征' : '终点特征'] as Record<string, unknown> | undefined
  return feature?.关联面 === '主板面' ? 'main' : 'sub'
}

export function endpointWrapDirections(sample: EndpointNormals, which: 'start' | 'end', side: BaojiaoWrapSide) {
  const normal = (side === 'main' ? sample.nMain : sample.nSub).clone().normalize()
  const wrapDir = normal.clone().negate()
  const outward = sample.tangent.clone().normalize().multiplyScalar(which === 'start' ? -1 : 1)
  const incoming = which === 'start' ? wrapDir.clone().negate() : sample.tangent.clone().normalize()
  const outgoing = which === 'start' ? sample.tangent.clone().normalize() : wrapDir.clone()
  // 走到所选板边外侧后，其支撑面由端部外法向取代；另一板法向保留。
  const outerNormals = side === 'main'
    ? { nMain: outward.clone(), nSub: sample.nSub.clone() }
    : { nMain: sample.nMain.clone(), nSub: outward.clone() }
  return { normal, wrapDir, outward, incoming, outgoing, outerNormals }
}
