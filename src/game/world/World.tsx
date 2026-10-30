import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { Environment } from './Environment'
import { Road } from './Road'
import type { LevelConfig } from '../levels/level.config'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import { IntersectionWorld } from '../intersection/IntersectionWorld'

export function World({ level, intersectionRuntime }: { level: LevelConfig; intersectionRuntime: IntersectionRuntime | null }) {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[level.roadLength / 2, 0.25, level.roadHalfWidth + level.sidewalkWidth]}
          position={[0, -0.3, 0]}
        />
      </RigidBody>
      <Road level={level} />
      <IntersectionWorld level={level} runtime={intersectionRuntime} />
      <Environment level={level} />
    </>
  )
}
