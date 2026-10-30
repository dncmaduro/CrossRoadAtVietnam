import { useLayoutEffect, useMemo, useRef } from 'react'
import { Box, Cylinder } from '@react-three/drei'
import * as THREE from 'three'
import { getLaneConfigs, type LevelConfig } from '../levels/level.config'

function PavingTiles({ z, color, width, roadLength }: { z: number; color: string; width: number; roadLength: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const tiles = useMemo(() => {
    const columns = Math.ceil(roadLength / 1.8)
    const rows = Math.max(2, Math.ceil(width / 1.75))
    return Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      return {
        x: -roadLength / 2 + 0.9 + column * 1.8,
        z: z - width / 2 + 0.88 + row * 1.75,
      }
    })
  }, [color, roadLength, width, z])

  useLayoutEffect(() => {
    if (!mesh.current) return
    tiles.forEach((tile, index) => {
      const matrix = new THREE.Matrix4().makeTranslation(tile.x, 0.285, tile.z)
      mesh.current?.setMatrixAt(index, matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [tiles])

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, tiles.length]} receiveShadow>
      <boxGeometry args={[1.62, 0.035, 1.57]} />
      <meshStandardMaterial color={color} roughness={0.96} />
    </instancedMesh>
  )
}

function DrainCover({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.315, z]}>
      <Box args={[1.25, 0.035, 0.46]}>
        <meshStandardMaterial color="#5a6360" roughness={0.98} />
      </Box>
      {[-0.38, -0.13, 0.13, 0.38].map((offset) => (
        <Box key={offset} args={[0.06, 0.045, 0.5]} position={[offset, 0.02, 0]}>
          <meshStandardMaterial color="#252d2e" roughness={0.9} />
        </Box>
      ))}
    </group>
  )
}

function RoadManhole({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.02, z]}>
      <Cylinder args={[0.34, 0.34, 0.035, 16]}>
        <meshStandardMaterial color="#555d5c" roughness={0.98} />
      </Cylinder>
      {[-0.12, 0.12].map((offset) => (
        <Box key={offset} args={[0.045, 0.045, 0.48]} rotation={[0, offset > 0 ? 0.7 : -0.7, 0]} position={[0, 0.025, 0]}>
          <meshStandardMaterial color="#2e3535" roughness={0.96} />
        </Box>
      ))}
    </group>
  )
}

function Median({ level }: { level: LevelConfig }) {
  if (!level.median) return null

  const segmentLength = (level.roadLength - level.median.openingWidth) / 2
  const segmentOffset = (level.median.openingWidth + segmentLength) / 2

  return (
    <group>
      {[-1, 1].map((direction) => (
        <group key={direction} position={[direction * segmentOffset, 0, 0]}>
          <Box args={[segmentLength, 0.2, level.median!.width]}>
            <meshStandardMaterial color="#9c9d87" roughness={0.92} />
          </Box>
          <Box args={[segmentLength, 0.055, level.median!.width + 0.18]} position={[0, 0.14, 0]}>
            <meshStandardMaterial color="#c8c19e" roughness={0.9} />
          </Box>
        </group>
      ))}
      <Box args={[level.median.refugeLength, 0.07, level.median.width + 0.3]} position={[0, 0.03, 0]}>
        <meshStandardMaterial color="#b6af8d" roughness={0.9} />
      </Box>
      <Box args={[level.median.refugeLength - 0.6, 0.035, 0.16]} position={[0, 0.09, 0]}>
        <meshStandardMaterial color="#6c7f6b" roughness={0.92} />
      </Box>
    </group>
  )
}

export function Road({ level }: { level: LevelConfig }) {
  const lanes = getLaneConfigs(level)
  const roadLength = level.roadLength
  const roadHalfWidth = level.roadHalfWidth
  const sidewalkZ = roadHalfWidth + level.sidewalkWidth / 2
  const laneBoundaryZs = level.median
    ? lanes.flatMap((lane, index) => (index > 0 && lanes[index - 1].direction === lane.direction ? [lane.centerZ - lane.laneWidth / 2] : []))
    : lanes.slice(0, -1).map((lane, index) => (lane.centerZ + lanes[index + 1].centerZ) / 2)
  const dashCount = Math.ceil(roadLength / 3.35)
  const dashStart = -roadLength / 2 + 1.8

  return (
    <group>
      <Box args={[roadLength, 0.12, roadHalfWidth * 2]} position={[0, -0.08, 0]} receiveShadow>
        <meshStandardMaterial color="#3b4648" roughness={0.98} />
      </Box>

      <Box args={[roadLength, 0.42, level.sidewalkWidth]} position={[0, 0.05, -sidewalkZ]} receiveShadow>
        <meshStandardMaterial color="#d7c8a2" roughness={0.9} />
      </Box>
      <Box args={[roadLength, 0.42, level.sidewalkWidth]} position={[0, 0.05, sidewalkZ]} receiveShadow>
        <meshStandardMaterial color="#b9d1b0" roughness={0.9} />
      </Box>
      <PavingTiles z={-sidewalkZ} color="#d3c6a7" width={level.sidewalkWidth} roadLength={roadLength} />
      <PavingTiles z={sidewalkZ} color="#bacab4" width={level.sidewalkWidth} roadLength={roadLength} />

      {[
        [-roadLength * 0.29, -roadHalfWidth * 0.62, 4.2, 0.95],
        [roadLength * 0.18, -roadHalfWidth * 0.23, 3.4, -0.9],
        [-roadLength * 0.07, roadHalfWidth * 0.61, 5.2, 0.35],
        [roadLength * 0.36, roadHalfWidth * 0.33, 2.7, -0.5],
        [-roadLength * 0.42, roadHalfWidth * 0.17, 3.1, 0.6],
      ].map(([x, z, width, rotation]) => (
        <Box key={`${x}-${z}`} args={[width, 0.018, 0.72]} position={[x, -0.005, z]} rotation={[0, rotation, 0]}>
          <meshStandardMaterial color="#424b4c" roughness={1} />
        </Box>
      ))}
      {lanes.map((lane) => (
        <Box key={`wear-${lane.index}`} args={[Math.min(7.4, roadLength * 0.3), 0.012, 0.14]} position={[-roadLength * 0.2, -0.002, lane.centerZ]}>
          <meshStandardMaterial color="#303839" transparent opacity={0.35} roughness={1} />
        </Box>
      ))}

      <Box args={[roadLength, 0.18, 0.18]} position={[0, 0.28, -(roadHalfWidth - 0.02)]}>
        <meshStandardMaterial color="#f1cf5a" />
      </Box>
      <Box args={[roadLength, 0.18, 0.18]} position={[0, 0.28, roadHalfWidth - 0.02]}>
        <meshStandardMaterial color="#f1cf5a" />
      </Box>

      {laneBoundaryZs.map((z) => (
        <group key={z}>
          {Array.from({ length: dashCount }, (_, index) => (
            <Box key={index} args={[1.9, 0.025, 0.07]} position={[dashStart + index * 3.35, 0.04, z]}>
              <meshStandardMaterial color="#d8dddd" />
            </Box>
          ))}
        </group>
      ))}

      {[-roadHalfWidth + 0.18, roadHalfWidth - 0.18].map((z) => (
        <Box key={z} args={[roadLength, 0.035, 0.1]} position={[0, 0.05, z]}>
          <meshStandardMaterial color="#c8c2a2" roughness={0.82} />
        </Box>
      ))}

      {lanes.map((lane) => (
        <Box key={`marker-${lane.index}`} args={[0.18, 0.035, 0.72]} position={[-roadLength / 2 + 2.4, 0.05, lane.centerZ]}>
          <meshStandardMaterial color="#e7eceb" />
        </Box>
      ))}

      <Box args={[0.32, 0.45, roadHalfWidth * 2 + 0.4]} position={[-roadLength / 2 - 0.1, 0.12, 0]}>
        <meshStandardMaterial color="#9da8a6" />
      </Box>
      <Box args={[0.32, 0.45, roadHalfWidth * 2 + 0.4]} position={[roadLength / 2 + 0.1, 0.12, 0]}>
        <meshStandardMaterial color="#9da8a6" />
      </Box>

      <Box args={[roadLength, 0.24, 0.24]} position={[0, 0.12, -roadHalfWidth]} receiveShadow>
        <meshStandardMaterial color="#b7b6a9" roughness={0.92} />
      </Box>
      <Box args={[roadLength, 0.24, 0.24]} position={[0, 0.12, roadHalfWidth]} receiveShadow>
        <meshStandardMaterial color="#b7b6a9" roughness={0.92} />
      </Box>
      <Box args={[roadLength, 0.055, 0.3]} position={[0, 0.275, -roadHalfWidth]}>
        <meshStandardMaterial color="#d3d0bb" roughness={0.9} />
      </Box>
      <Box args={[roadLength, 0.055, 0.3]} position={[0, 0.275, roadHalfWidth]}>
        <meshStandardMaterial color="#d3d0bb" roughness={0.9} />
      </Box>

      <Box args={[roadLength, 0.06, 0.14]} position={[0, 0.075, -roadHalfWidth - 0.22]}>
        <meshStandardMaterial color="#596361" roughness={1} />
      </Box>
      <Box args={[roadLength, 0.06, 0.14]} position={[0, 0.075, roadHalfWidth + 0.22]}>
        <meshStandardMaterial color="#596361" roughness={1} />
      </Box>
      <DrainCover x={-roadLength * 0.33} z={-roadHalfWidth - 0.12} />
      <DrainCover x={roadLength * 0.33} z={-roadHalfWidth - 0.12} />
      <DrainCover x={-roadLength * 0.15} z={roadHalfWidth + 0.12} />
      <DrainCover x={roadLength * 0.27} z={roadHalfWidth + 0.12} />
      <RoadManhole x={-roadLength * 0.23} z={-roadHalfWidth + 0.52} />
      <RoadManhole x={roadLength * 0.31} z={roadHalfWidth - 0.52} />

      <Box args={[roadLength, 0.04, 0.65]} position={[0, 0.29, sidewalkZ]}>
        <meshStandardMaterial color="#4f8b62" />
      </Box>
      <Box args={[roadLength, 0.04, 0.65]} position={[0, 0.29, -sidewalkZ]}>
        <meshStandardMaterial color="#c59b52" />
      </Box>
      <Median level={level} />
    </group>
  )
}
