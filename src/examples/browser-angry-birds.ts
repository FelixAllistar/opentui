import * as THREE from "three"
import { WebGPURenderer } from "three/webgpu"
import RAPIER from "@dimforge/rapier2d-simd-compat"

// @ts-ignore
import cratePath from "./assets/crate.png"
// @ts-ignore
import birdPath from "./assets/heart.png"

const WORLD_HEIGHT = 20.0
const GRAVITY = { x: 0.0, y: -9.81 }
const LAUNCH_POWER_MULTIPLIER = 8.0
const MAX_LAUNCH_DISTANCE = 4.0

interface PhysicsObject {
  rigidBody: RAPIER.RigidBody
  mesh: THREE.Mesh
  width: number
  height: number
  id: string
  type: 'bird' | 'box'
}

interface GameState {
  renderer: WebGPURenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  physicsWorld: RAPIER.World
  groundCollider: RAPIER.Collider
  leftWallCollider: RAPIER.Collider
  rightWallCollider: RAPIER.Collider
  objects: PhysicsObject[]

  // Bird launching
  bird: PhysicsObject | null
  birdStartPosition: THREE.Vector3
  isDragging: boolean
  dragOffset: THREE.Vector2
  launchDirection: THREE.Vector2

  // Scenery
  movingClouds: { mesh: THREE.Group; velocity: THREE.Vector3 }[]

  // Resources
  birdTexture: THREE.Texture | null
  boxTexture: THREE.Texture | null

  // Mouse interaction
  mouse: THREE.Vector2
  raycaster: THREE.Raycaster
  draggableObjects: THREE.Object3D[]

  lastFrameTime: number
}

let gameState: GameState | null = null

const materialFactory = (texture: THREE.Texture) =>
  new THREE.MeshPhongMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    depthWrite: true,
    shininess: 30,
  })

async function createPhysicsObject(
  state: GameState,
  x: number,
  y: number,
  width: number,
  height: number,
  type: 'bird' | 'box',
  isStatic: boolean = false
): Promise<PhysicsObject | null> {
  const rigidBodyDesc = isStatic
    ? RAPIER.RigidBodyDesc.fixed().setTranslation(x, y)
    : RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y)

  const rigidBody = state.physicsWorld.createRigidBody(rigidBodyDesc)

  const colliderDesc = type === 'bird'
    ? RAPIER.ColliderDesc.ball(Math.min(width, height) * 0.4).setDensity(3.0)
    : RAPIER.ColliderDesc.cuboid(width * 0.4, height * 0.4)

  colliderDesc.setRestitution(0.3).setFriction(0.8)
  state.physicsWorld.createCollider(colliderDesc, rigidBody)

  const id = `${type}_${Date.now()}_${Math.random()}`
  const texture = type === 'bird' ? state.birdTexture : state.boxTexture

  if (!texture) {
    console.warn(`Texture for ${type} not loaded.`)
    return null
  }

  let geometry: THREE.BufferGeometry
  if (type === 'bird') {
    geometry = new THREE.SphereGeometry(Math.min(width, height) * 0.5, 32, 16)
  } else {
    geometry = new THREE.BoxGeometry(width, height, width) // Use width for depth too
  }

  const material = materialFactory(texture)
  const mesh = new THREE.Mesh(geometry, material)

  mesh.position.set(x, y, 0)
  mesh.scale.set(1, 1, 1)
  mesh.castShadow = true
  mesh.receiveShadow = true
  state.scene.add(mesh)

  const obj: PhysicsObject = {
    rigidBody,
    mesh,
    width,
    height,
    id,
    type,
  }

  state.objects.push(obj)
  state.draggableObjects.push(mesh)
  return obj
}

async function createLevel(state: GameState): Promise<void> {
  const boxSize = 0.8
  const startX = 6
  const startY = -6
  const rows = 5

  for (let row = 0; row < rows; row++) {
    const boxesInRow = rows - row
    const rowStartX = startX + (row * boxSize * 0.5)
    const rowY = startY + (row * boxSize * 1.1)

    for (let col = 0; col < boxesInRow; col++) {
      const boxX = rowStartX + (col * boxSize * 1.1)
      await createPhysicsObject(state, boxX, rowY, boxSize, boxSize, 'box')
    }
  }
}

async function resetBird(state: GameState): Promise<void> {
  if (state.bird) {
    state.scene.remove(state.bird.mesh)
    state.physicsWorld.removeRigidBody(state.bird.rigidBody)
    const index = state.objects.indexOf(state.bird)
    if (index > -1) state.objects.splice(index, 1)
    const draggableIndex = state.draggableObjects.indexOf(state.bird.mesh)
    if (draggableIndex > -1) state.draggableObjects.splice(draggableIndex, 1)
  }

  const birdSize = 0.6
  const bird = await createPhysicsObject(state, state.birdStartPosition.x, state.birdStartPosition.y, birdSize, birdSize, 'bird')
  if (bird) {
    state.bird = bird
    bird.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased)
  }
}

function launchBird(state: GameState): void {
  if (!state.bird) return

  const birdPos = state.bird.rigidBody.translation()
  const launchCenter = state.birdStartPosition
  const dragVector = new THREE.Vector2(birdPos.x - launchCenter.x, birdPos.y - launchCenter.y)
  const dragDistance = dragVector.length()

  if (dragDistance < 0.1) return

  state.bird.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic)

  const launchVelocity = dragVector.clone().negate().multiplyScalar(LAUNCH_POWER_MULTIPLIER)
  state.bird.rigidBody.setLinvel({ x: launchVelocity.x, y: launchVelocity.y }, true)

  const spin = (Math.random() - 0.5) * 10
  state.bird.rigidBody.setAngvel(spin, true)
}

async function createScenery(state: GameState): Promise<void> {
  const { scene } = state;

  const cloudMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: true });
  const numClouds = 8;

  for (let i = 0; i < numClouds; i++) {
    const cloudGroup = new THREE.Group();
    const numBlobs = 3 + Math.floor(Math.random() * 3);

    for (let j = 0; j < numBlobs; j++) {
      const blobSize = 0.8 + Math.random() * 0.8;
      const blobGeometry = new THREE.SphereGeometry(blobSize, 8, 6);
      const blob = new THREE.Mesh(blobGeometry, cloudMaterial);
      
      blob.scale.set(1.5, 1.0, 1.0);

      if (j > 0) {
        blob.position.set(
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 0.5
        );
      }
      cloudGroup.add(blob);
    }

    cloudGroup.castShadow = true;
    cloudGroup.receiveShadow = true;

    const z = -5 - Math.random() * 5;
    const y = Math.random() * 4 + 4;
    const x = (Math.random() - 0.5) * 35;
    cloudGroup.position.set(x, y, z);

    const scale = 0.5 + (z - (-10)) / 5 * 0.8;
    cloudGroup.scale.set(scale, scale, scale);

    scene.add(cloudGroup);

    const speed = (0.001 + Math.random() * 0.002) * (scale * 1.2);
    state.movingClouds.push({
      mesh: cloudGroup,
      velocity: new THREE.Vector3(speed, 0, 0),
    });
  }

  const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
  const leavesMaterial = new THREE.MeshPhongMaterial({ color: 0x2E8B57 });

  for (let i = 0; i < 5; i++) {
    const tree = new THREE.Group();
    const trunkHeight = 1.5 + Math.random() * 0.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, trunkHeight, 8), trunkMaterial);

    const leavesHeight = 2.5 + Math.random();
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.2, leavesHeight, 8), leavesMaterial);
    leaves.position.y = trunkHeight / 2 + leavesHeight / 2.5;

    tree.add(trunk, leaves);

    const side = i < 2 ? -1 : 1;
    const x = side * (10 + Math.random() * 4);
    const y = -8 + trunkHeight / 2;
    tree.position.set(x, y, -3);
    tree.scale.set(0.7, 0.7, 0.7);
    tree.receiveShadow = true;
    tree.castShadow = true;
    scene.add(tree);
  }
}

async function resetLevel(state: GameState): Promise<void> {
  for (const obj of state.objects) {
    state.scene.remove(obj.mesh)
    state.physicsWorld.removeRigidBody(obj.rigidBody)
  }
  state.objects = []
  state.draggableObjects = []
  state.bird = null

  await createLevel(state)
  await resetBird(state)
}

function updatePhysics(state: GameState, deltaTime: number): void {
  state.physicsWorld.step()

  for (const obj of state.objects) {
    const position = obj.rigidBody.translation()
    const rotation = obj.rigidBody.rotation()

    obj.mesh.position.set(position.x, position.y, 0)
    obj.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotation)
  }

  state.objects = state.objects.filter((obj) => {
    const pos = obj.rigidBody.translation()
    if (pos.y < -15 || Math.abs(pos.x) > 20) {
      state.scene.remove(obj.mesh)
      state.physicsWorld.removeRigidBody(obj.rigidBody)
      if (obj === state.bird) {
        state.bird = null
        setTimeout(() => resetBird(state), 2000)
      }
      return false
    }
    return true
  })
}

function worldToScreen(state: GameState, worldX: number, worldY: number): THREE.Vector2 {
  const width = window.innerWidth
  const height = window.innerHeight

  const worldWidth = WORLD_HEIGHT * (width / height)

  const screenX = (worldX + worldWidth / 2) / worldWidth * width
  const screenY = height - ((worldY + WORLD_HEIGHT / 2) / WORLD_HEIGHT * height)

  return new THREE.Vector2(screenX, screenY)
}

function screenToWorld(state: GameState, screenX: number, screenY: number): THREE.Vector2 {
  const width = window.innerWidth
  const height = window.innerHeight

  const worldWidth = WORLD_HEIGHT * (width / height)

  const worldX = (screenX / width) * worldWidth - (worldWidth / 2)
  const worldY = WORLD_HEIGHT / 2 - (screenY / height) * WORLD_HEIGHT

  return new THREE.Vector2(worldX, worldY)
}

async function init(): Promise<void> {
  await RAPIER.init()

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87ceeb) // Light blue sky

  const renderer = new WebGPURenderer()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  document.body.appendChild(renderer.domElement)

  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const worldWidth = WORLD_HEIGHT * (window.innerWidth / window.innerHeight)
  const camera = new THREE.OrthographicCamera(
    worldWidth / -2, worldWidth / 2,
    WORLD_HEIGHT / 2, WORLD_HEIGHT / -2,
    0.1, 1000
  )
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  scene.add(camera)

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.5)
  sunLight.position.set(10, 20, 15)
  sunLight.castShadow = true

  const shadowCamSize = 15
  sunLight.shadow.camera.left = -shadowCamSize
  sunLight.shadow.camera.right = shadowCamSize
  sunLight.shadow.camera.top = shadowCamSize
  sunLight.shadow.camera.bottom = -shadowCamSize
  sunLight.shadow.camera.near = 0.5
  sunLight.shadow.camera.far = 50
  sunLight.shadow.mapSize.width = 1024
  sunLight.shadow.mapSize.height = 1024
  sunLight.shadow.camera.updateProjectionMatrix()
  scene.add(sunLight)

  const sunGeometry = new THREE.SphereGeometry(1.0, 16, 16)
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffffee, fog: false })
  const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial)
  sunMesh.position.copy(sunLight.position)
  scene.add(sunMesh)

  const groundGeometry = new THREE.BoxGeometry(30, 0.4, 0.2)
  const groundMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff,
  })
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
  groundMesh.position.set(0, -8, -0.5)
  groundMesh.receiveShadow = true
  scene.add(groundMesh)

  const physicsWorld = new RAPIER.World(GRAVITY)

  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(15.0, 0.5)
  const groundCollider = physicsWorld.createCollider(groundColliderDesc)
  groundCollider.setTranslation({ x: 0.0, y: -8.0 })

  const leftWallDesc = RAPIER.ColliderDesc.cuboid(0.5, 15.0)
  const leftWallCollider = physicsWorld.createCollider(leftWallDesc)
  leftWallCollider.setTranslation({ x: -15.0, y: 0.0 })

  const rightWallDesc = RAPIER.ColliderDesc.cuboid(0.5, 15.0)
  const rightWallCollider = physicsWorld.createCollider(rightWallDesc)
  rightWallCollider.setTranslation({ x: 15.0, y: 0.0 })

  const textureLoader = new THREE.TextureLoader()
  const birdTexture = await textureLoader.loadAsync(birdPath)
  const boxTexture = await textureLoader.loadAsync(cratePath)

  gameState = {
    renderer, scene, camera, physicsWorld, groundCollider, leftWallCollider, rightWallCollider,
    objects: [], bird: null, birdStartPosition: new THREE.Vector3(-8, -3, 0),
    isDragging: false, dragOffset: new THREE.Vector2(), launchDirection: new THREE.Vector2(),
    movingClouds: [], birdTexture, boxTexture,
    mouse: new THREE.Vector2(), raycaster: new THREE.Raycaster(), draggableObjects: [],
    lastFrameTime: performance.now()
  }

  await createScenery(gameState)
  await createLevel(gameState)
  await resetBird(gameState)

  window.addEventListener('resize', onWindowResize)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown)

  animate()
}

function onWindowResize(): void {
  if (!gameState) return
  const width = window.innerWidth
  const height = window.innerHeight
  gameState.camera.aspect = width / height
  gameState.camera.updateProjectionMatrix()
  gameState.renderer.setSize(width, height)
}

function onPointerDown(event: PointerEvent): void {
  if (!gameState || !gameState.bird) return

  gameState.mouse.x = (event.clientX / window.innerWidth) * 2 - 1
  gameState.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

  gameState.raycaster.setFromCamera(gameState.mouse, gameState.camera)

  const intersects = gameState.raycaster.intersectObjects(gameState.draggableObjects)

  if (intersects.length > 0 && intersects[0].object === gameState.bird.mesh) {
    gameState.isDragging = true
    const birdPos = gameState.bird.rigidBody.translation()
    const worldPos = screenToWorld(gameState, event.clientX, event.clientY)
    gameState.dragOffset.set(worldPos.x - birdPos.x, worldPos.y - birdPos.y)
    event.preventDefault()
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!gameState || !gameState.bird || !gameState.isDragging) return

  const worldPos = screenToWorld(gameState, event.clientX, event.clientY)

  const targetPos = new THREE.Vector2(
    worldPos.x - gameState.dragOffset.x,
    worldPos.y - gameState.dragOffset.y
  )

  const launchCenter = gameState.birdStartPosition
  const dragVector = targetPos.clone().sub(new THREE.Vector2(launchCenter.x, launchCenter.y))
  const dragDistance = dragVector.length()

  if (dragDistance > MAX_LAUNCH_DISTANCE) {
    dragVector.normalize().multiplyScalar(MAX_LAUNCH_DISTANCE)
    targetPos.copy(new THREE.Vector2(launchCenter.x, launchCenter.y).add(dragVector))
  }

  gameState.bird.rigidBody.setTranslation({ x: targetPos.x, y: targetPos.y }, true)
  gameState.bird.mesh.position.set(targetPos.x, targetPos.y, 0)

  gameState.launchDirection.copy(dragVector).negate().normalize()

  event.preventDefault()
}

function onPointerUp(event: PointerEvent): void {
  if (gameState && gameState.isDragging) {
    launchBird(gameState)
    gameState.isDragging = false
    event.preventDefault()
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (!gameState) return
  switch (event.key) {
    case 'r':
      resetLevel(gameState)
      break
    case 'n':
      resetBird(gameState)
      break
  }
}

function animate(): void {
  requestAnimationFrame(animate)
  if (!gameState) return

  const currentTime = performance.now()
  const deltaTime = (currentTime - gameState.lastFrameTime) / 1000 // Convert to seconds
  gameState.lastFrameTime = currentTime

  // Move clouds
  const worldWidth = gameState.camera.right - gameState.camera.left;
  for (const cloud of gameState.movingClouds) {
    cloud.mesh.position.x += cloud.velocity.x * deltaTime * 10; // Scale velocity for browser

    if (cloud.mesh.position.x > worldWidth / 2 + 5) {
      cloud.mesh.position.x = -worldWidth / 2 - 5;

      const z = -5 - Math.random() * 5;
      cloud.mesh.position.y = Math.random() * 4 + 4;
      cloud.mesh.position.z = z;

      const scale = 0.5 + (z - (-10)) / 5 * 0.8;
      cloud.mesh.scale.set(scale, scale, scale);

      const speed = (0.001 + Math.random() * 0.002) * (scale * 1.2);
      cloud.velocity.x = speed;
    }
  }

  updatePhysics(gameState, deltaTime)
  gameState.renderer.render(gameState.scene, gameState.camera)
}

init()
