import { useEffect, useMemo } from 'react'
import { Box, Cylinder, Icosahedron, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { LevelConfig } from '../levels/level.config'

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
      context.font = '700 54px Arial, sans-serif'
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

function ShopProps({ label, facadeZ }: { label: string; facadeZ: number }) {
  if (label === 'CÀ PHÊ' || label === 'PHỞ' || label === 'BÚN') {
    return (
      <group position={[0, 0, facadeZ - 0.58]}>
        <Cylinder args={[0.28, 0.28, 0.7, 8]} position={[-1.15, 0.35, 0]}>
          <meshStandardMaterial color="#a96d4f" roughness={0.9} />
        </Cylinder>
        <Cylinder args={[0.28, 0.28, 0.7, 8]} position={[1.25, 0.35, 0]}>
          <meshStandardMaterial color="#a96d4f" roughness={0.9} />
        </Cylinder>
        <Box args={[1.65, 0.1, 0.72]} position={[0.05, 0.78, 0]}>
          <meshStandardMaterial color="#6f5340" roughness={0.92} />
        </Box>
        <Cylinder args={[0.17, 0.22, 0.32, 8]} position={[-1.85, 0.16, 0.02]}>
          <meshStandardMaterial color="#557773" roughness={0.9} />
        </Cylinder>
      </group>
    )
  }

  if (label === 'SỬA XE') {
    return (
      <group position={[0, 0, facadeZ - 0.45]}>
        {[-1.7, -1.25, -0.8].map((x) => (
          <Box key={x} args={[0.34, 0.34, 0.46]} position={[x, 0.18, 0]}>
            <meshStandardMaterial color="#9c7043" roughness={0.94} />
          </Box>
        ))}
        <Box args={[0.1, 1.4, 0.1]} position={[1.75, 0.7, 0]}>
          <meshStandardMaterial color="#626a66" roughness={0.82} metalness={0.15} />
        </Box>
        <Box args={[0.8, 0.08, 0.08]} position={[1.75, 1.33, 0]}>
          <meshStandardMaterial color="#626a66" roughness={0.82} metalness={0.15} />
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
  const height = 4.7 + (Math.abs(x) % 3) * 0.45 + heightBias
  const facing = z > 0 ? 0 : Math.PI
  const facadeZ = -1.46
  const hasTank = Math.abs(x) % 3 === 0
  const windowRows = height > 5.3 ? [3.1, 4.45] : [3.25]

  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <Box args={[5.2, height, 2.8]} position={[0, height / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={bodyColor} roughness={0.9} />
      </Box>
      <Box args={[5.4, 0.22, 3]} position={[0, height + 0.1, 0]} castShadow>
        <meshStandardMaterial color={roofColor} roughness={0.86} />
      </Box>
      <Box args={[5.2, 0.24, 2.84]} position={[0, 0.16, 0]}>
        <meshStandardMaterial color="#8a6a58" roughness={0.96} />
      </Box>
      <Box args={[5.35, 0.16, 0.85]} position={[0, 2.15, -1.72]} castShadow>
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </Box>

      <Box args={[4.58, 1.48, 0.08]} position={[-0.38, 0.82, facadeZ]}>
        <meshStandardMaterial color="#3c5b60" roughness={0.34} metalness={0.03} />
      </Box>
      {[-2.38, -1.15, 0.08, 1.3].map((frameX) => (
        <Box key={frameX} args={[0.07, 1.58, 0.1]} position={[frameX, 0.82, facadeZ - 0.03]}>
          <meshStandardMaterial color="#5f5d53" roughness={0.78} metalness={0.12} />
        </Box>
      ))}
      <Box args={[0.9, 1.58, 0.09]} position={[1.55, 0.82, facadeZ]}>
        <meshStandardMaterial color="#65493b" roughness={0.86} />
      </Box>
      <Box args={[0.14, height, 0.1]} position={[-2.52, height / 2, facadeZ + 0.02]}>
        <meshStandardMaterial color="#9b604a" roughness={0.86} />
      </Box>

      <SignBoard label={label} color={signColor} position={[-0.65, height - 0.78, facadeZ - 0.08]} />
      <ShopProps label={label} facadeZ={facadeZ} />
      <AirConditioner x={1.75} y={height - 1.05} facadeZ={facadeZ} />

      {windowRows.map((windowY, row) => (
        <group key={windowY}>
          {[-1.45, 0.05].map((windowX) => (
            <group key={windowX}>
              <Box args={[1.02, 1.12, 0.08]} position={[windowX, windowY, facadeZ]}>
                <meshStandardMaterial color="#78a0a4" roughness={0.36} metalness={0.04} />
              </Box>
              <Box args={[1.08, 0.08, 0.12]} position={[windowX, windowY - 0.6, facadeZ - 0.04]}>
                <meshStandardMaterial color="#65675e" roughness={0.8} />
              </Box>
              {row === 0 && <Box args={[1.1, 0.08, 0.12]} position={[windowX, windowY + 0.6, facadeZ - 0.04]}>
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

function UtilityPole({ x, z, transformer = false }: { x: number; z: number; transformer?: boolean }) {
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
    </group>
  )
}

function StreetTree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
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
        <meshStandardMaterial color="#5d8760" roughness={1} flatShading />
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

function DistantBackdrop({ backdropZ, roadLength }: { backdropZ: number; roadLength: number }) {
  const halfLength = roadLength / 2
  const north = [-halfLength + 2, -halfLength / 2, 0, halfLength / 2, halfLength - 2]
  return (
    <group>
      {north.map((x, index) => (
        <Box key={`north-backdrop-${x}`} args={[5.4, 5.5 + (index % 3), 2]} position={[x, 2.75 + (index % 3) * 0.5, backdropZ]}>
          <meshStandardMaterial color={['#9ca9a4', '#a9b2aa', '#8e9e9a'][index % 3]} roughness={1} />
        </Box>
      ))}
      {[-halfLength + 3, -halfLength / 3, halfLength / 4, halfLength - 3].map((x, index) => (
        <Box key={`south-backdrop-${x}`} args={[6.3, 4.5 + (index % 2), 2]} position={[x, 2.25 + (index % 2) * 0.4, -backdropZ]}>
          <meshStandardMaterial color="#a5aaa0" roughness={1} />
        </Box>
      ))}
    </group>
  )
}

export function Environment({ level }: { level: LevelConfig }) {
  const shopPalette = [
    ['#b87961', '#705548', '#dfb85f'],
    ['#78928c', '#4e6765', '#cd8557'],
    ['#c2a36b', '#786047', '#719476'],
    ['#92768b', '#5b4a5e', '#d7b765'],
  ]
  const shopZ = level.roadHalfWidth + level.sidewalkWidth + 1.4
  const streetZ = level.roadHalfWidth + level.sidewalkWidth - 0.8
  const scooterZ = level.roadHalfWidth + level.sidewalkWidth + 0.1
  const shopXs = level.environmentPreset === 'smallStreet'
    ? [-13, -6.5, 0, 6.5, 13]
    : level.environmentPreset === 'arterial'
      ? [-14, -7, 0, 7, 14]
      : [-12, -6, 0, 6, 12]
  const heightBias = level.environmentPreset === 'smallStreet' ? -0.35 : level.environmentPreset === 'arterial' ? 0.45 : 0.35
  const extraScooters = level.environmentPreset === 'smallStreet' || level.environmentPreset === 'motorcycle'
  const northLabels = ['TẠP HÓA', 'CÀ PHÊ', 'PHỞ', 'SỬA XE', 'CẮT TÓC']
  const southLabels = ['BÚN', 'TẠP HÓA', 'CÀ PHÊ', 'SỬA XE', 'PHỞ']
  const cableEnd = level.roadLength / 2 + 1.2

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
            {index !== 2 && (
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

      {[-level.roadLength * 0.34, level.roadLength * 0.03, level.roadLength * 0.39].map((x, index) => (
        <group key={`poles-${x}`}>
          <UtilityPole x={x} z={streetZ} transformer={index === 1} />
          <UtilityPole x={x + 1.2} z={-streetZ} transformer={index === 2} />
        </group>
      ))}
      <Line points={[[-cableEnd, 6.65, streetZ], [0, 6.95, streetZ], [cableEnd, 6.65, streetZ]]} color="#3e4d4b" lineWidth={1} />
      <Line points={[[-cableEnd, 6.35, streetZ + 0.35], [0, 6.65, streetZ + 0.35], [cableEnd, 6.35, streetZ + 0.35]]} color="#5a6560" lineWidth={0.8} />
      <Line points={[[-cableEnd, 6.08, streetZ - 0.25], [0, 6.34, streetZ - 0.25], [cableEnd, 6.08, streetZ - 0.25]]} color="#616b65" lineWidth={0.65} />
      <Line points={[[-cableEnd, 6.4, -streetZ], [0, 6.7, -streetZ], [cableEnd, 6.4, -streetZ]]} color="#3e4d4b" lineWidth={1} />
      <Line points={[[-cableEnd, 6.13, -streetZ - 0.33], [0, 6.45, -streetZ - 0.33], [cableEnd, 6.13, -streetZ - 0.33]]} color="#5a6560" lineWidth={0.8} />

      {[-level.roadLength * 0.42, -level.roadLength * 0.17, level.roadLength * 0.17, level.roadLength * 0.42].map((x) => (
        <group key={`street-${x}`}>
          <StreetTree x={x} z={streetZ - 0.35} />
          <StreetLamp x={x + 1.25} z={streetZ - 0.4} />
        </group>
      ))}
      {(extraScooters ? [-level.roadLength * 0.38, -level.roadLength * 0.08, level.roadLength * 0.25, level.roadLength * 0.42] : [-10, 2, 12]).map((x, index) => (
        <ParkedScooter key={`scooter-north-${x}`} x={x} z={scooterZ} color={['#c95e4e', '#2d6e74', '#e0b647', '#b75350'][index]} />
      ))}
      {(extraScooters ? [-level.roadLength * 0.34, -level.roadLength * 0.08, level.roadLength * 0.3] : [-12, -3, 8]).map((x, index) => (
        <ParkedScooter key={`scooter-south-${x}`} x={x} z={-scooterZ} color={['#d8ad3f', '#4d7e66', '#b75350'][index]} flip />
      ))}
    </group>
  )
}
