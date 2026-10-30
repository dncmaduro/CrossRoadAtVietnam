import { useEffect, useMemo, useRef } from 'react'
import { Box, Cylinder, Icosahedron, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { LevelConfig } from '../levels/level.config'

const vietnamStarShape = (() => {
  const shape = new THREE.Shape()
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / 5
    const radius = index % 2 === 0 ? 0.13 : 0.055
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
})()

type SignBoardProps = {
  label: string
  color: string
  position: [number, number, number]
  width?: number
}

function SignBoard({ label, color, position, width = 2.65 }: SignBoardProps) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 112
    const context = canvas.getContext('2d')
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#182a2c'
      context.font = `${label.length > 9 ? 700 : 800} ${label.length > 9 ? 38 : 50}px Arial, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(label, canvas.width / 2, canvas.height / 2 + 2)
    }
    const nextTexture = new THREE.CanvasTexture(canvas)
    nextTexture.colorSpace = THREE.SRGBColorSpace
    return nextTexture
  }, [label])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group position={position}>
      <Box args={[width, 0.62, 0.1]}>
        <meshStandardMaterial color={color} roughness={0.78} />
      </Box>
      <mesh position={[0, 0, -0.056]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width - 0.16, 0.48]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  )
}

function ProjectingSign({ color, position }: { color: string; position: [number, number, number] }) {
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      <Box args={[0.08, 1.08, 0.62]} castShadow>
        <meshStandardMaterial color={color} roughness={0.8} />
      </Box>
      <Box args={[0.12, 0.86, 0.08]} position={[0, -0.02, -0.35]}>
        <meshStandardMaterial color="#5b625e" roughness={0.88} metalness={0.12} />
      </Box>
    </group>
  )
}

function Balcony({ height, facadeZ }: { height: number; facadeZ: number }) {
  return (
    <group position={[0.55, height - 1.35, facadeZ - 0.2]}>
      <Box args={[3.2, 0.14, 0.95]} position={[0, 0, -0.26]}>
        <meshStandardMaterial color="#a6aaa0" roughness={0.9} />
      </Box>
      <Box args={[3.2, 0.08, 0.08]} position={[0, 0.72, -0.74]}>
        <meshStandardMaterial color="#535b57" roughness={0.75} metalness={0.1} />
      </Box>
      {[-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35].map((x) => (
        <Box key={x} args={[0.055, 0.75, 0.055]} position={[x, 0.36, -0.74]}>
          <meshStandardMaterial color="#535b57" roughness={0.75} metalness={0.1} />
        </Box>
      ))}
      <Cylinder args={[0.18, 0.2, 0.25, 8]} position={[-1.05, 0.2, -0.43]}>
        <meshStandardMaterial color="#a76d50" roughness={0.9} />
      </Cylinder>
      <Icosahedron args={[0.32, 1]} position={[-1.05, 0.48, -0.43]}>
        <meshStandardMaterial color="#5e8860" roughness={1} flatShading />
      </Icosahedron>
    </group>
  )
}

function AirConditioner({ x, y, facadeZ }: { x: number; y: number; facadeZ: number }) {
  return (
    <group position={[x, y, facadeZ - 0.13]}>
      <Box args={[0.75, 0.48, 0.22]}>
        <meshStandardMaterial color="#d4d1c2" roughness={0.82} />
      </Box>
      {[-0.2, -0.07, 0.07, 0.2].map((offset) => (
        <Box key={offset} args={[0.045, 0.24, 0.025]} position={[offset, 0, -0.13]}>
          <meshStandardMaterial color="#707878" roughness={0.9} />
        </Box>
      ))}
      <Box args={[0.9, 0.06, 0.3]} position={[0, -0.3, 0.08]}>
        <meshStandardMaterial color="#5e6662" roughness={0.86} metalness={0.12} />
      </Box>
    </group>
  )
}

function StorefrontAwning({ color, facadeZ, width }: { color: string; facadeZ: number; width: number }) {
  const awningWidth = width - 0.55

  return (
    <group position={[0, 2.05, facadeZ - 0.38]}>
      <Box args={[awningWidth, 0.12, 0.72]} rotation={[0.16, 0, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.82} />
      </Box>
      {[-awningWidth / 2 + 0.12, awningWidth / 2 - 0.12].map((x) => (
        <Cylinder key={x} args={[0.035, 0.035, 0.58, 6]} position={[x, -0.24, -0.25]}>
          <meshStandardMaterial color="#626a66" roughness={0.86} metalness={0.12} />
        </Cylinder>
      ))}
    </group>
  )
}

function PottedPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.2, 0.26, 0.32, 8]} position={[0, 0.16, 0]}>
        <meshStandardMaterial color="#a56547" roughness={0.92} />
      </Cylinder>
      <Icosahedron args={[0.34, 1]} position={[0, 0.56, 0]}>
        <meshStandardMaterial color="#4f805d" roughness={1} flatShading />
      </Icosahedron>
    </group>
  )
}

function ShopProps({ label, facadeZ }: { label: string; facadeZ: number }) {
  if (['CÀ PHÊ', 'PHỞ BÒ', 'PHỞ GÀ', 'BÚN CHẢ', 'CƠM BÌNH DÂN', 'BÁNH MÌ', 'TRÀ ĐÁ'].includes(label)) {
    return (
      <group position={[0, 0, facadeZ - 0.58]}>
        <Cylinder args={[0.26, 0.26, 0.66, 8]} position={[-1.15, 0.33, 0]}>
          <meshStandardMaterial color="#a96d4f" roughness={0.9} />
        </Cylinder>
        <Cylinder args={[0.26, 0.26, 0.66, 8]} position={[1.25, 0.33, 0]}>
          <meshStandardMaterial color="#a96d4f" roughness={0.9} />
        </Cylinder>
        <Box args={[1.65, 0.1, 0.72]} position={[0.05, 0.73, 0]}>
          <meshStandardMaterial color="#6f5340" roughness={0.92} />
        </Box>
        <Cylinder args={[0.17, 0.22, 0.32, 8]} position={[-1.85, 0.16, 0.02]}>
          <meshStandardMaterial color="#557773" roughness={0.9} />
        </Cylinder>
        {[-1.65, -0.6, 0.62, 1.62].map((x) => (
          <group key={x} position={[x, 0, 0.32]}>
            <Cylinder args={[0.13, 0.16, 0.42, 8]} position={[0, 0.21, 0]}>
              <meshStandardMaterial color="#c65c48" roughness={0.9} />
            </Cylinder>
            <Cylinder args={[0.17, 0.17, 0.045, 8]} position={[0, 0.44, 0]}>
              <meshStandardMaterial color="#3f6864" roughness={0.9} />
            </Cylinder>
          </group>
        ))}
      </group>
    )
  }

  if (label === 'SỬA XE MÁY' || label === 'RỬA XE') {
    return (
      <group position={[0, 0, facadeZ - 0.45]}>
        {[-1.7, -1.25, -0.8].map((x) => (
          <Cylinder key={x} args={[0.22, 0.22, 0.12, 12]} rotation={[Math.PI / 2, 0, 0]} position={[x, 0.23, 0]}>
            <meshStandardMaterial color="#252b2b" roughness={0.96} />
          </Cylinder>
        ))}
        <Box args={[0.1, 1.4, 0.1]} position={[1.75, 0.7, 0]}>
          <meshStandardMaterial color="#626a66" roughness={0.82} metalness={0.15} />
        </Box>
        <Box args={[0.8, 0.08, 0.08]} position={[1.75, 1.33, 0]}>
          <meshStandardMaterial color="#626a66" roughness={0.82} metalness={0.15} />
        </Box>
        <Box args={[0.62, 0.44, 0.42]} position={[1.16, 0.24, 0.02]}>
          <meshStandardMaterial color="#9c7043" roughness={0.94} />
        </Box>
      </group>
    )
  }

  if (label === 'TẠP HÓA') {
    return (
      <group position={[0, 0, facadeZ - 0.44]}>
        {[-1.75, -1.2, -0.65].map((x, index) => (
          <Box key={x} args={[0.42, 0.36 + index * 0.08, 0.48]} position={[x, 0.18 + index * 0.04, 0]}>
            <meshStandardMaterial color={index % 2 === 0 ? '#b77b48' : '#687f70'} roughness={0.94} />
          </Box>
        ))}
        <Box args={[0.1, 1.35, 0.42]} position={[1.45, 0.68, 0]}>
          <meshStandardMaterial color="#77756b" roughness={0.88} metalness={0.12} />
        </Box>
        <Box args={[0.72, 0.08, 0.46]} position={[1.45, 1.35, 0]}>
          <meshStandardMaterial color="#737b72" roughness={0.88} metalness={0.12} />
        </Box>
      </group>
    )
  }

  return (
    <group position={[0, 0, facadeZ - 0.44]}>
      <Box args={[0.58, 0.55, 0.48]} position={[-1.85, 0.28, 0]}>
        <meshStandardMaterial color="#a77a45" roughness={0.94} />
      </Box>
      <Box args={[0.58, 0.45, 0.48]} position={[-1.2, 0.23, 0]}>
        <meshStandardMaterial color="#728d78" roughness={0.92} />
      </Box>
      <Box args={[0.42, 0.9, 0.38]} position={[1.75, 0.45, 0]}>
        <meshStandardMaterial color="#596b64" roughness={0.82} />
      </Box>
    </group>
  )
}

type ShopHouseProps = {
  x: number
  z: number
  bodyColor: string
  roofColor: string
  signColor: string
  label: string
  heightBias?: number
  hasBalcony?: boolean
}

function ShopHouse({ x, z, bodyColor, roofColor, signColor, label, heightBias = 0, hasBalcony = false }: ShopHouseProps) {
  const variation = Math.abs(Math.round(x * 10)) % 4
  const width = 3.85 + variation * 0.22
  const depth = 3.45
  const height = 5.4 + (variation % 3) * 0.48 + heightBias
  const facing = z > 0 ? 0 : Math.PI
  const facadeZ = -depth / 2 - 0.02
  const hasTank = Math.abs(x) % 3 === 0
  const windowRows = height > 6.25 ? [3.2, 4.62, 6.04] : [3.25, 4.7]

  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <Box args={[width, height, depth]} position={[0, height / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={bodyColor} roughness={0.9} />
      </Box>
      <Box args={[width + 0.22, 0.22, depth + 0.2]} position={[0, height + 0.1, 0]} castShadow>
        <meshStandardMaterial color={roofColor} roughness={0.86} />
      </Box>
      <Box args={[width, 0.24, depth]} position={[0, 0.16, 0]}>
        <meshStandardMaterial color="#8a6a58" roughness={0.96} />
      </Box>
      <Box args={[width + 0.12, 0.16, 0.85]} position={[0, 2.15, facadeZ - 0.26]} castShadow>
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </Box>

      <Box args={[width - 0.62, 1.48, 0.08]} position={[-0.12, 0.82, facadeZ]}>
        <meshStandardMaterial color="#3c5b60" roughness={0.34} metalness={0.03} />
      </Box>
      {[-width / 2 + 0.16, -width * 0.19, width * 0.18, width / 2 - 0.16].map((frameX) => (
        <Box key={frameX} args={[0.07, 1.58, 0.1]} position={[frameX, 0.82, facadeZ - 0.03]}>
          <meshStandardMaterial color="#5f5d53" roughness={0.78} metalness={0.12} />
        </Box>
      ))}
      <Box args={[0.72, 1.58, 0.09]} position={[width * 0.33, 0.82, facadeZ]}>
        <meshStandardMaterial color="#65493b" roughness={0.86} />
      </Box>
      <Box args={[0.14, height, 0.1]} position={[-width / 2 + 0.05, height / 2, facadeZ + 0.02]}>
        <meshStandardMaterial color="#9b604a" roughness={0.86} />
      </Box>

      <SignBoard label={label} color={signColor} width={label.length > 9 ? 3.25 : 2.82} position={[-0.1, height - 0.78, facadeZ - 0.08]} />
      <ProjectingSign color={signColor} position={[width / 2 + 0.12, 2.75, facadeZ - 0.04]} />
      <StorefrontAwning color={signColor} facadeZ={facadeZ} width={width} />
      <ShopProps label={label} facadeZ={facadeZ} />
      <PottedPlant position={[width / 2 - 0.36, 0, facadeZ - 0.66]} />
      <AirConditioner x={width / 2 - 0.7} y={height - 1.05} facadeZ={facadeZ} />

      {windowRows.map((windowY, row) => (
        <group key={windowY}>
          {[-width * 0.26, width * 0.13].map((windowX) => (
            <group key={windowX}>
              <Box args={[0.86, 1.12, 0.08]} position={[windowX, windowY, facadeZ]}>
                <meshStandardMaterial color="#78a0a4" roughness={0.36} metalness={0.04} />
              </Box>
              <Box args={[0.92, 0.08, 0.12]} position={[windowX, windowY - 0.6, facadeZ - 0.04]}>
                <meshStandardMaterial color="#65675e" roughness={0.8} />
              </Box>
              {row === 0 && <Box args={[0.92, 0.08, 0.12]} position={[windowX, windowY + 0.6, facadeZ - 0.04]}>
                <meshStandardMaterial color="#65675e" roughness={0.8} />
              </Box>}
            </group>
          ))}
        </group>
      ))}

      {hasBalcony && <Balcony height={height} facadeZ={facadeZ} />}
      {hasTank && (
        <group position={[1.35, height + 0.6, 0]}>
          <Box args={[0.8, 0.08, 0.8]} position={[0, -0.35, 0]}>
            <meshStandardMaterial color="#59625e" roughness={0.88} metalness={0.08} />
          </Box>
          <Cylinder args={[0.38, 0.38, 0.72, 8]}>
            <meshStandardMaterial color="#526f76" roughness={0.68} metalness={0.05} />
          </Cylinder>
        </group>
      )}
    </group>
  )
}

function UtilityPole({ x, z, transformer = false, flag = false }: { x: number; z: number; transformer?: boolean; flag?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <Cylinder args={[0.11, 0.16, 7.3, 6]} position={[0, 3.65, 0]} castShadow>
        <meshStandardMaterial color="#4c514d" roughness={0.9} />
      </Cylinder>
      <Box args={[1.8, 0.12, 0.12]} position={[0, 6.65, 0]}>
        <meshStandardMaterial color="#4c514d" roughness={0.9} metalness={0.08} />
      </Box>
      {[-0.65, 0, 0.65].map((offset) => (
        <Cylinder key={offset} args={[0.045, 0.045, 0.24, 6]} position={[offset, 6.82, 0]}>
          <meshStandardMaterial color="#d1b873" roughness={0.7} />
        </Cylinder>
      ))}
      {transformer && (
      <Box args={[0.65, 0.62, 0.55]} position={[0.42, 5.72, 0.18]}>
          <meshStandardMaterial color="#737b72" roughness={0.78} metalness={0.12} />
        </Box>
      )}
      {flag && (
        <group position={[0.05, 5.75, -0.18]}>
          <Box args={[0.82, 0.48, 0.04]}>
            <meshStandardMaterial color="#b8443e" roughness={0.84} />
          </Box>
          <mesh position={[0, 0, -0.035]}>
            <shapeGeometry args={[vietnamStarShape]} />
            <meshStandardMaterial color="#f2cf5b" roughness={0.72} emissive="#5c4613" emissiveIntensity={0.12} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  )
}

function StreetTree({ x, z, scale = 1, canopyColor = '#5d8760' }: { x: number; z: number; scale?: number; canopyColor?: string }) {
  return (
    <group position={[x, 0, z]} scale={[scale, scale, scale]}>
      <Box args={[1.12, 0.035, 1.12]} position={[0, 0.32, 0]}>
        <meshStandardMaterial color="#83735c" roughness={1} />
      </Box>
      <Cylinder args={[0.18, 0.24, 2.4, 7]} position={[0, 1.2, 0]}>
        <meshStandardMaterial color="#6f4e38" roughness={1} />
      </Cylinder>
      <Cylinder args={[0.07, 0.1, 1.25, 6]} rotation={[0, 0, -0.58]} position={[-0.32, 2.35, 0]}>
        <meshStandardMaterial color="#6f4e38" roughness={1} />
      </Cylinder>
      <Cylinder args={[0.07, 0.1, 1.1, 6]} rotation={[0, 0, 0.65]} position={[0.36, 2.45, 0]}>
        <meshStandardMaterial color="#6f4e38" roughness={1} />
      </Cylinder>
      <Icosahedron args={[1.18, 1]} position={[0, 3, 0]} castShadow>
        <meshStandardMaterial color={canopyColor} roughness={1} flatShading />
      </Icosahedron>
      <Icosahedron args={[0.75, 1]} position={[0.65, 3.45, 0.1]} castShadow>
        <meshStandardMaterial color="#78a06d" roughness={1} flatShading />
      </Icosahedron>
      <Icosahedron args={[0.62, 1]} position={[-0.62, 3.35, 0.12]} castShadow>
        <meshStandardMaterial color="#4e7857" roughness={1} flatShading />
      </Icosahedron>
    </group>
  )
}

function StreetLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Cylinder args={[0.06, 0.09, 3.8, 6]} position={[0, 1.9, 0]} castShadow>
        <meshStandardMaterial color="#55615c" roughness={0.82} />
      </Cylinder>
      <Box args={[0.38, 0.13, 0.18]} position={[0, 3.82, -0.16]}>
        <meshStandardMaterial color="#e7d38a" emissive="#5c4a19" emissiveIntensity={0.18} roughness={0.65} />
      </Box>
    </group>
  )
}

function CableSpan({
  xStart,
  xEnd,
  z,
  baseY,
  sag,
  zOffset,
  color,
  lineWidth,
}: {
  xStart: number
  xEnd: number
  z: number
  baseY: number
  sag: number
  zOffset: number
  color: string
  lineWidth: number
}) {
  const midpoint = (xStart + xEnd) / 2
  return (
    <Line
      points={[
        [xStart, baseY, z],
        [midpoint, baseY - sag, z + zOffset],
        [xEnd, baseY, z],
      ]}
      color={color}
      lineWidth={lineWidth}
    />
  )
}

function ParkedScooter({ x, z, color, flip = false }: { x: number; z: number; color: string; flip?: boolean }) {
  return (
    <group position={[x, 0, z]} rotation={[0, flip ? Math.PI : 0, 0]} scale={0.72}>
      <Cylinder args={[0.2, 0.2, 0.12, 10]} rotation={[Math.PI / 2, 0, 0]} position={[-0.62, 0.2, 0]}>
        <meshStandardMaterial color="#242b2c" roughness={0.9} />
      </Cylinder>
      <Cylinder args={[0.2, 0.2, 0.12, 10]} rotation={[Math.PI / 2, 0, 0]} position={[0.62, 0.2, 0]}>
        <meshStandardMaterial color="#242b2c" roughness={0.9} />
      </Cylinder>
      <Cylinder args={[0.1, 0.13, 0.16, 8]} rotation={[Math.PI / 2, 0, 0]} position={[-0.62, 0.2, 0]}>
        <meshStandardMaterial color="#b3b7ac" roughness={0.65} metalness={0.22} />
      </Cylinder>
      <Cylinder args={[0.1, 0.13, 0.16, 8]} rotation={[Math.PI / 2, 0, 0]} position={[0.62, 0.2, 0]}>
        <meshStandardMaterial color="#b3b7ac" roughness={0.65} metalness={0.22} />
      </Cylinder>
      <Box args={[0.9, 0.3, 0.32]} position={[0, 0.52, 0]}>
        <meshStandardMaterial color={color} roughness={0.7} />
      </Box>
      <Box args={[0.1, 0.72, 0.1]} position={[0.46, 0.78, 0]}>
        <meshStandardMaterial color="#303738" roughness={0.76} />
      </Box>
      <Box args={[0.5, 0.05, 0.08]} position={[0.49, 1.08, 0]}>
        <meshStandardMaterial color="#303738" roughness={0.76} />
      </Box>
      <Box args={[0.06, 0.08, 0.08]} position={[0.7, 1.02, 0.18]}>
        <meshStandardMaterial color="#d7c178" emissive="#6d4e1c" emissiveIntensity={0.2} />
      </Box>
    </group>
  )
}

function SidewalkPedestrian({
  x,
  z,
  direction,
  bound,
  index,
}: {
  x: number
  z: number
  direction: 1 | -1
  bound: number
  index: number
}) {
  const group = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const phase = useRef(index * 1.7)

  useFrame((_, delta) => {
    phase.current += delta * 6.5
    const current = group.current
    if (current) {
      current.position.x += direction * delta * (0.32 + index * 0.035)
      if (current.position.x > bound) current.position.x = -bound
      if (current.position.x < -bound) current.position.x = bound
    }
    if (leftLeg.current) leftLeg.current.rotation.z = Math.sin(phase.current) * 0.32
    if (rightLeg.current) rightLeg.current.rotation.z = Math.sin(phase.current + Math.PI) * 0.32
  })

  return (
    <group ref={group} position={[x, 0, z]} rotation={[0, direction === 1 ? 0 : Math.PI, 0]}>
      <Box args={[0.28, 0.58, 0.22]} position={[0, 1.02, 0]}>
        <meshStandardMaterial color={index % 2 === 0 ? '#536d68' : '#a05c48'} roughness={0.9} />
      </Box>
      <Icosahedron args={[0.17, 1]} position={[0, 1.48, 0]}>
        <meshStandardMaterial color="#b88462" roughness={0.96} flatShading />
      </Icosahedron>
      <group ref={leftLeg} position={[-0.09, 0.76, 0]}>
        <Box args={[0.09, 0.54, 0.09]} position={[0, -0.27, 0]}>
          <meshStandardMaterial color="#303b3d" roughness={0.92} />
        </Box>
      </group>
      <group ref={rightLeg} position={[0.09, 0.76, 0]}>
        <Box args={[0.09, 0.54, 0.09]} position={[0, -0.27, 0]}>
          <meshStandardMaterial color="#303b3d" roughness={0.92} />
        </Box>
      </group>
      {[-1, 1].map((side) => (
        <Box key={side} args={[0.07, 0.42, 0.07]} position={[side * 0.2, 0.98, 0]} rotation={[0, 0, side * -0.25]}>
          <meshStandardMaterial color="#536d68" roughness={0.9} />
        </Box>
      ))}
    </group>
  )
}

function DistantBackdrop({ backdropZ, roadLength }: { backdropZ: number; roadLength: number }) {
  const halfLength = roadLength / 2
  const north = Array.from({ length: 9 }, (_, index) => -halfLength + 2.5 + index * ((roadLength - 5) / 8))
  const south = Array.from({ length: 8 }, (_, index) => -halfLength + 3.5 + index * ((roadLength - 7) / 7))
  return (
    <group>
      {north.map((x, index) => (
        <Box key={`north-backdrop-${x}`} args={[5.4, 5.5 + (index % 3), 2]} position={[x, 2.75 + (index % 3) * 0.5, backdropZ]}>
          <meshStandardMaterial color={['#9ca9a4', '#a9b2aa', '#8e9e9a'][index % 3]} roughness={1} />
        </Box>
      ))}
      {south.map((x, index) => (
        <Box key={`south-backdrop-${x}`} args={[6.3, 4.5 + (index % 2), 2]} position={[x, 2.25 + (index % 2) * 0.4, -backdropZ]}>
          <meshStandardMaterial color="#a5aaa0" roughness={1} />
        </Box>
      ))}
    </group>
  )
}

export function Environment({ level }: { level: LevelConfig }) {
  const shopPalette = [
    ['#aa8068', '#63534a', '#cf493d'],
    ['#78918b', '#4e5e5d', '#d3ad3d'],
    ['#b49b6c', '#6b594a', '#3f7a78'],
    ['#9a877f', '#5a5651', '#3a6490'],
  ]
  const shopZ = level.roadHalfWidth + level.sidewalkWidth + 1.7
  const streetZ = level.roadHalfWidth + level.sidewalkWidth - 0.7
  const scooterZ = level.roadHalfWidth + level.sidewalkWidth + 0.1
  const shopXs = Array.from({ length: 11 }, (_, index) => (-0.46 + index * 0.092) * level.roadLength)
  const heightBias = level.environmentPreset === 'smallStreet' ? -0.35 : level.environmentPreset === 'arterial' ? 0.45 : 0.35
  const extraScooters = level.environmentPreset === 'smallStreet' || level.environmentPreset === 'motorcycle'
  const northLabels = ['TẠP HÓA', 'PHỞ BÒ', 'SỬA XE MÁY', 'CÀ PHÊ', 'CƠM BÌNH DÂN', 'CẮT TÓC', 'BÚN CHẢ', 'TRÀ ĐÁ', 'BÁNH MÌ', 'CƠM GÀ', 'CÀ PHÊ']
  const southLabels = ['BÚN CHẢ', 'TRÀ ĐÁ', 'RỬA XE', 'PHỞ GÀ', 'BÁNH MÌ', 'CÀ PHÊ', 'PHỞ BÒ', 'TẠP HÓA', 'CƠM BÌNH DÂN', 'CẮT TÓC', 'SỬA XE MÁY']
  const poleXs = [-0.44, -0.22, 0, 0.22, 0.44].map((ratio) => ratio * level.roadLength)
  const cableProfiles = [
    { baseY: 6.65, sag: 0.24, zOffset: 0.16, color: '#3e4d4b', lineWidth: 1 },
    { baseY: 6.35, sag: 0.2, zOffset: 0.25, color: '#5a6560', lineWidth: 0.8 },
    { baseY: 6.08, sag: 0.18, zOffset: -0.25, color: '#616b65', lineWidth: 0.65 },
  ]

  return (
    <group>
      <DistantBackdrop backdropZ={shopZ + 3.6} roadLength={level.roadLength} />
      {shopXs.map((x, index) => {
        const palette = shopPalette[index % shopPalette.length]
        const southPalette = shopPalette[(index + 2) % shopPalette.length]
        return (
          <group key={`shops-${x}`}>
            <ShopHouse
              x={x}
              z={shopZ}
              bodyColor={palette[0]}
              roofColor={palette[1]}
              signColor={palette[2]}
              label={northLabels[index]}
              heightBias={heightBias}
              hasBalcony={index === 0 || index === 3}
            />
            {index !== 2 && index !== 5 && (
              <ShopHouse
                x={x + 0.35}
                z={-shopZ}
                bodyColor={southPalette[0]}
                roofColor={southPalette[1]}
                signColor={southPalette[2]}
                label={southLabels[index]}
                heightBias={index === 1 ? -0.45 : heightBias * 0.5}
                hasBalcony={index === 1 || index === 4}
              />
            )}
          </group>
        )
      })}

      {poleXs.map((x, index) => (
        <group key={`poles-${x}`}>
          <UtilityPole x={x} z={streetZ} transformer={index === 1} flag={index === 0} />
          <UtilityPole x={x + 1.2} z={-streetZ} transformer={index === 3} flag={index === 4} />
        </group>
      ))}
      {[-1, 1].map((side) => cableProfiles.map((profile, profileIndex) => (
        poleXs.slice(0, -1).map((x, spanIndex) => (
          <CableSpan
            key={`cable-${side}-${profileIndex}-${spanIndex}`}
            xStart={x}
            xEnd={poleXs[spanIndex + 1]}
            z={side * (streetZ + profile.zOffset)}
            baseY={profile.baseY}
            sag={profile.sag}
            zOffset={side * 0.08}
            color={profile.color}
            lineWidth={profile.lineWidth}
          />
        ))
      )))}
      {shopXs.filter((_, index) => index % 2 === 0).map((x) => (
        <Line key={`service-drop-${x}`} points={[[x, 6.5, streetZ], [x + 0.24, 4.3, streetZ + 0.35], [x + 0.1, 3.35, streetZ + 1.25]]} color="#59645f" lineWidth={0.5} />
      ))}

      {[
        [-0.4 * level.roadLength, streetZ - 0.4, 1.08, '#5d8760'],
        [-0.2 * level.roadLength, -streetZ - 0.5, 0.86, '#4e7857'],
        [0.02 * level.roadLength, streetZ - 0.34, 1.18, '#6c8d5f'],
        [0.24 * level.roadLength, -streetZ - 0.42, 0.94, '#557d5b'],
        [0.41 * level.roadLength, streetZ - 0.36, 1.04, '#668961'],
      ].map(([x, z, scale, canopyColor], index) => (
        <group key={`street-${x}`}>
          <StreetTree x={x as number} z={z as number} scale={scale as number} canopyColor={canopyColor as string} />
          {index !== 1 && <StreetLamp x={(x as number) + 1.25} z={(z as number) - 0.05} />}
        </group>
      ))}
      {(extraScooters
        ? [-0.43, -0.29, -0.13, 0.05, 0.23, 0.4].map((ratio) => ratio * level.roadLength)
        : [-0.37, -0.12, 0.14, 0.39].map((ratio) => ratio * level.roadLength)
      ).map((x, index) => (
        <ParkedScooter key={`scooter-north-${x}`} x={x} z={scooterZ} color={['#c95e4e', '#2d6e74', '#e0b647', '#b75350', '#536d68', '#d7d0b2'][index % 6]} />
      ))}
      {(extraScooters
        ? [-0.38, -0.2, -0.02, 0.16, 0.34].map((ratio) => ratio * level.roadLength)
        : [-0.32, -0.08, 0.18, 0.4].map((ratio) => ratio * level.roadLength)
      ).map((x, index) => (
        <ParkedScooter key={`scooter-south-${x}`} x={x} z={-scooterZ} color={['#d8ad3f', '#4d7e66', '#b75350', '#2f6e73', '#c7c2a2'][index % 5]} flip />
      ))}
      <SidewalkPedestrian
        x={-level.roadLength * 0.28}
        z={level.roadHalfWidth + level.sidewalkWidth * 0.54}
        direction={1}
        bound={level.roadLength / 2 - 1.5}
        index={0}
      />
      <SidewalkPedestrian
        x={level.roadLength * 0.22}
        z={-(level.roadHalfWidth + level.sidewalkWidth * 0.54)}
        direction={-1}
        bound={level.roadLength / 2 - 1.5}
        index={1}
      />
      {level.environmentPreset !== 'smallStreet' && (
        <>
          <SidewalkPedestrian
            x={level.roadLength * 0.42}
            z={level.roadHalfWidth + level.sidewalkWidth * 0.48}
            direction={-1}
            bound={level.roadLength / 2 - 1.5}
            index={2}
          />
          <SidewalkPedestrian
            x={-level.roadLength * 0.46}
            z={-(level.roadHalfWidth + level.sidewalkWidth * 0.48)}
            direction={1}
            bound={level.roadLength / 2 - 1.5}
            index={3}
          />
        </>
      )}
    </group>
  )
}
