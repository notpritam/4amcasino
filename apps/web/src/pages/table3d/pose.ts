import * as THREE from 'three';

export const smooth = (x: number) => {
  const p = THREE.MathUtils.clamp(x, 0, 1);
  return p * p * (3 - 2 * p);
};
export const envelope = (p: number) => smooth(p / 0.18) * smooth((1 - p) / 0.22);
const jointNames = [
  'body',
  'armL',
  'armR',
  'elbowL',
  'elbowR',
  'head',
  'legL',
  'legR',
  'kneeL',
  'kneeR',
  'footL',
  'footR',
];
export function poseNodes(char: THREE.Group): THREE.Object3D[] {
  return [char, ...jointNames.map((name) => char.userData[name] as THREE.Object3D)];
}
export function capturePose(char: THREE.Group) {
  return poseNodes(char).map((node) => ({
    position: node.position.clone(),
    rotation: node.quaternion.clone(),
    scale: node.scale.clone(),
  }));
}
export type Pose = ReturnType<typeof capturePose>;
/** Blend from a saved pose to the current pose, including on interruption. */
export function blendPose(char: THREE.Group, from: Pose, amount: number) {
  poseNodes(char).forEach((node, i) => {
    node.position.lerpVectors(from[i]!.position, node.position, amount);
    const targetRotation = node.quaternion.clone();
    node.quaternion.copy(from[i]!.rotation).slerp(targetRotation, amount);
    node.scale.lerpVectors(from[i]!.scale, node.scale, amount);
  });
}
