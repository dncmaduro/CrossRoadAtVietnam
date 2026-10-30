import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { Environment } from './Environment'
import { Road } from './Road'
import type { LevelConfig } from '../levels/level.config'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import { IntersectionWorld } from '../intersection/IntersectionWorld'
import { ACTIVE_COLLISION_TYPES_ALL, WORLD_COLLISION_GROUPS } from '../traffic/trafficPhysics'

export function World({ level, intersectionRuntime }: { level: LevelConfig; intersectionRuntime: IntersectionRuntime | null }) {
  return (
    <>
      <RigidBody type="fixed" colliders={false} collisionGroups={WORLD_COLLISION_GROUPS} activeCollisionTypes={ACTIVE_COLLISION_TYPES_ALL}>
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
