import * as THREE from 'three'

/** Read-only parameter snapshot from the supplied URDF. No meshes, robot motion or connection. */
export const ROBOT_URDF_PARAMETERS = {
  source: '/robot/baoshan_test_abb.urdf',
  robotName: 'baoshan_test_abb',
  baseLink: 'manipulator_base_link',
  toolLink: 'manipulator_tool0',
  baseJoint: 'manipulator_world_joint',
  baseOriginMm: [3685, 7864, 1664.52],
  baseRpyRad: [0, 3.1415, 3.1415],
  toolJoint: 'manipulator_end_effector_joint',
  toolOriginMm: [14.5, 0, 0],
  toolRpyRad: [0, Math.PI / 2, 0],
  externalAxes: [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
} as const

/** URDF uses fixed-axis RPY: Rz(yaw) Ry(pitch) Rx(roll). */
export function robotBaseQuaternion(): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...ROBOT_URDF_PARAMETERS.baseRpyRad, 'ZYX'))
}

export function robotBaseAxes(): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } {
  const q = robotBaseQuaternion()
  return { x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    y: new THREE.Vector3(0, 1, 0).applyQuaternion(q), z: new THREE.Vector3(0, 0, 1).applyQuaternion(q) }
}

/** URDF link6 -> tool0, in mm. The 14.5 mm wrist transform must be applied only once. */
export function urdfTool0InLink6(): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...ROBOT_URDF_PARAMETERS.toolRpyRad, 'ZYX'))
  return new THREE.Matrix4().compose(new THREE.Vector3(...ROBOT_URDF_PARAMETERS.toolOriginMm), q,
    new THREE.Vector3(1, 1, 1))
}
