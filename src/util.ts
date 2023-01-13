import { Vec3 } from "vec3";
import { Client, ServerClient } from "minecraft-protocol";
import { Bot, GameState } from "mineflayer";
import { performance } from "perf_hooks";
import { Item as ItemType, NotchItem } from "prismarine-item";
import Item from "prismarine-item";
import { packetAbilities } from "@rob9315/mcproxy";
const fetch = require('node-fetch')
const ChatMessage = require('prismarine-chat')('1.12.2')
import { EventEmitter } from 'events'
import { setTimeout as timeoutPromise } from 'timers/promises'
import { IPositionTransformer } from "@rob9315/mcproxy/lib/positionTransformer";

const NoneItemData = {
  blockId: -1,
  itemCount: undefined,
  itemDamage: undefined,
  nbtData: undefined
}

class FakeEntity {
  knownPosition: Vec3
  lastSendPos: number
  yaw: number
  pitch: number
  oldYaw: number
  oldPitch: number
  onGround: boolean
  mainHand?: NotchItem
  offHand?: NotchItem
  armor: Array<NotchItem | undefined>
  constructor(pos: Vec3, yaw: number, pitch: number) {
    this.knownPosition = pos
    this.yaw = yaw
    this.pitch = pitch
    this.oldYaw = yaw
    this.oldPitch = pitch
    this.onGround = true
    this.lastSendPos = performance.now()
    this.armor = []
  }
}

export function sendMessage(client: ServerClient | Client, message: string, position: number = 1) {
  const messageObj = new ChatMessage(message)
  client.write('chat', { message: messageObj.json.toString(), position })
}

export class FakePlayer {
  name: string
  uuid: string
  skinLookup: boolean
  bot: Bot
  fakePlayerEntity: FakeEntity
  static fakePlayerId: number = 9999
  listenerMove: () => void = () => { }
  listenerForceMove: () => void = () => { }
  listenerPhysics: () => void = () => { }
  listenerInventory: () => void = () => { }
  listenerWorldLeave: () => void = () => { }
  listenerWorldJoin: () => void = () => { }
  pItem: typeof ItemType
  connectedClients: ServerClient[]
  private isSpawnedMap: Record<string, boolean> = {}
  private positionTransformer: IPositionTransformer | undefined
  constructor(bot: Bot, options: { username?: string, uuid?: string, skinLookup?: boolean, positionTransformer?: IPositionTransformer } = {}) {
    this.name = options.username ?? 'Player'
    this.uuid = options.uuid ?? 'a01e3843-e521-3998-958a-f459800e4d11'
    this.skinLookup = options.skinLookup ?? true
    this.bot = bot
    this.fakePlayerEntity = new FakeEntity(bot.entity.position.clone(), bot.entity.yaw, bot.entity.pitch)
    this.pItem = Item(bot.version)
    this.initListener()
    this.connectedClients = []
    this.positionTransformer = options.positionTransformer
  }

  static gameModeToNotchian(gamemode: string): 1 | 0 | 2 {
    switch (gamemode) {
      case ('survival'):
        return 0
      case ('creative'):
        return 1
      case ('adventure'):
        return 2
      default:
        return 0
    }
  }

  private writeRaw(client: ServerClient | Client, name: string, data: any) {
    if (this.positionTransformer) {
      const result = this.positionTransformer.onSToCPacket(name, data)
      if (!result) return
      if (result && result.length > 1) return
      const [transformedName, transformedData] = result[0]
      client.write(transformedName, transformedData)
    } else {
      client.write(name, data)
    }
  }

  private initListener() {
    const writeIfSpawned = (name: string, data: Object) => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return
        this.writeRaw(c, name, data)
      })
    }
    this.listenerMove = () => {
      // From flying-squid updatePosition.js 
      // known position is very important because the diff (/delta) send to players is floored hence is not precise enough
      // storing the known position allows to compensate next time a diff is sent
      // without the known position, the error accumulate fast and player position is incorrect from the point of view
      // of other players
      // const knownPosition = this.fakePlayerEntity.knownPosition
      const position = this.bot.entity.position

      let entityPosition = position // 1.12.2 Specific   
      this.fakePlayerEntity.knownPosition = position
      this.fakePlayerEntity.onGround = this.bot.entity.onGround
      this.fakePlayerEntity.yaw = this.bot.entity.yaw
      this.fakePlayerEntity.pitch = this.bot.entity.pitch
      writeIfSpawned('entity_teleport', {
        entityId: FakePlayer.fakePlayerId,
        x: entityPosition.x,
        y: entityPosition.y,
        z: entityPosition.z,
        yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
        pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
        // onGround: this.bot.entity.onGround
        onGround: false
      })
      writeIfSpawned('entity_look', {
        entityId: FakePlayer.fakePlayerId,
        yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
        pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
        onGround: false
      })
      writeIfSpawned('entity_head_rotation', {
        entityId: FakePlayer.fakePlayerId,
        headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
      })

      // Yeah like this does not work
      // const diff = this.bot.entity.position.minus(knownPosition)
      // const maxDelta = 7 // 1.12.2 Specific
      // const lookChanged = this.fakePlayerEntity.yaw !== this.bot.entity.yaw || this.fakePlayerEntity.pitch !== this.bot.entity.pitch
      // if (diff.distanceTo(new Vec3(0, 0, 0)) !== 0) {
      //   // Player models are glitching through the ground with relative movement updates
      //   if (true || diff.abs().x > maxDelta || diff.abs().y > maxDelta || diff.abs().z > maxDelta) {
      //     let entityPosition = position // 1.12.2 Specific   
      //     this.fakePlayerEntity.knownPosition = position
      //     this.fakePlayerEntity.onGround = this.bot.entity.onGround
      //     this.fakePlayerEntity.yaw = this.bot.entity.yaw
      //     this.fakePlayerEntity.pitch = this.bot.entity.pitch

      //     console.info('Bot pos', entityPosition.toString())

      //     writeIfSpawned('entity_teleport', {
      //       entityId: FakePlayer.fakePlayerId,
      //       x: entityPosition.x,
      //       y: entityPosition.y,
      //       z: entityPosition.z,
      //       yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
      //       pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
      //       // onGround: this.bot.entity.onGround
      //       onGround: false
      //     })
      //     this.fakePlayerEntity.lastSendPos = performance.now()
      //   } else if (!lookChanged) {
      //     // 1.12.2 specific
      //     const delta = diff.scaled(32).scaled(128).floored()
      //     this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
      //     this.fakePlayerEntity.knownPosition = position
      //     this.fakePlayerEntity.onGround = this.bot.entity.onGround

      //     writeIfSpawned('rel_entity_move', {
      //       entityId: FakePlayer.fakePlayerId,
      //       dX: delta.x,
      //       dY: delta.y,
      //       dZ: delta.z,
      //       // onGround: this.bot.entity.onGround
      //       onGround: false
      //     })
      //   } else if (lookChanged) {
      //     // 1.12.2 specific
      //     const delta = diff.scaled(32).scaled(128).floored()
      //     this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
      //     this.fakePlayerEntity.knownPosition = position
      //     this.fakePlayerEntity.onGround = this.bot.entity.onGround
      //     this.fakePlayerEntity.yaw = this.bot.entity.yaw
      //     this.fakePlayerEntity.pitch = this.bot.entity.pitch

      //     writeIfSpawned('entity_move_look', {
      //       entityId: FakePlayer.fakePlayerId,
      //       dX: delta.x,
      //       dY: delta.y,
      //       dZ: delta.z,
      //       yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
      //       pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
      //       // onGround: this.bot.entity.onGround
      //       onGround: false
      //     })
      //     writeIfSpawned('entity_head_rotation', {
      //       entityId: FakePlayer.fakePlayerId,
      //       headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
      //     })
      //   }
      // } else {
      //   const { yaw, pitch, onGround } = this.bot.entity
      //   if (yaw === this.fakePlayerEntity.yaw && pitch === this.fakePlayerEntity.pitch) return
      //   this.fakePlayerEntity.onGround = onGround
      //   this.fakePlayerEntity.yaw = yaw
      //   this.fakePlayerEntity.pitch = pitch

      //   writeIfSpawned('entity_look', {
      //     entityId: FakePlayer.fakePlayerId,
      //     yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
      //     pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
      //     onGround: this.bot.entity.onGround
      //   })
      //   writeIfSpawned('entity_head_rotation', {
      //     entityId: FakePlayer.fakePlayerId,
      //     headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
      //   })
      // }
    }
    this.listenerForceMove = () => {
      this.fakePlayerEntity.knownPosition = this.bot.entity.position
      this.fakePlayerEntity.yaw = this.bot.entity.yaw
      this.fakePlayerEntity.pitch = this.bot.entity.pitch

      writeIfSpawned('entity_teleport', {
        entityId: 9999,
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y,
        z: this.bot.entity.position.z,
        yaw: this.bot.entity.yaw,
        pitch: this.bot.entity.pitch,
        onGround: this.bot.entity.onGround
      })
    }
    this.listenerInventory = () => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return
        this.updateEquipment(c)
      })
    }
    this.listenerWorldLeave = () => {
      const timeout = setTimeout(() => {
        this.bot._client.off('position', this.listenerWorldJoin)
      }, 5000)
      this.bot._client.once('position', () => {
        clearTimeout(timeout)
        this.listenerWorldJoin()
      })
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return
        this.writeDestroyEntity(c)
      })
    }
    this.listenerWorldJoin = () => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return
        this.writePlayerEntity(c)
      })
    }
    this.bot.on('move', this.listenerMove)
    // setInterval(this.listenerMove.bind(this), 50)
    this.bot.on('forcedMove', this.listenerForceMove)
    // @ts-ignore
    this.bot.inventory.on('updateSlot', this.listenerInventory)
    this.bot._client.on('mcproxy:heldItemSlotUpdate', () => {
      if (this.listenerInventory) this.listenerInventory()
    })
    this.bot.on('respawn', this.listenerWorldLeave)
  }

  register(client: ServerClient) {
    if (!this.connectedClients.includes(client)) {
      this.connectedClients.push(client)
      this.spawn(client)
    }
  }

  unregister(client: ServerClient) {
    this.connectedClients = this.connectedClients.filter(c => c !== client)
    this.deSpawn(client)
  }

  destroy() {
    this.bot.removeListener('move', this.listenerMove)
    this.bot.removeListener('forcedMove', this.listenerForceMove)
    if (this.listenerInventory) {
      // @ts-ignore
      this.bot.inventory.removeListener('updateSlot', this.listenerInventory)
    }
    this.bot.removeListener('respawn', this.listenerWorldLeave)
  }

  async writePlayerInfo(client: ServerClient) {
    // console.info('Sending request', `https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`)
    let properties = []
    if (this.skinLookup) {
      let response
      try {
        response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`)
        const p = await response.json() as any
        properties = p?.properties ?? []
        if (properties?.length !== 1) {
          console.warn('Skin lookup failed for', this.uuid)
        }
      } catch (err) {
        console.error('Skin lookup failed', err, 'UUID:', this.uuid)
      }
    }
    // console.info('Player profile', p)
    this.writeRaw(client, 'player_info', {
      action: 0,
      data: [{
        UUID: this.uuid,
        name: this.name,
        properties: properties,
        gamemode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode),
        ping: 0
      }]
    })
  }

  updateEquipment(client: ServerClient) {
    const NotchItemEqual = (item1?: NotchItem, item2?: NotchItem) => {
      item1 = item1 ?? {}
      item2 = item2 ?? {}
      return JSON.stringify(item1) === JSON.stringify(item2)
    }

    this.bot.updateHeldItem()
    const mainHand = this.bot.heldItem ? this.pItem.toNotch(this.bot.heldItem) : NoneItemData
    const offHand = this.bot.inventory.slots[45] ? this.pItem.toNotch(this.bot.inventory.slots[45]) : NoneItemData
    // Main hand
    if (!NotchItemEqual(mainHand, this.fakePlayerEntity.mainHand)) {
      this.writeRaw(client, 'entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: 0,
        item: mainHand
      })
      this.fakePlayerEntity.mainHand = mainHand
    }
    // Off-Hand
    if (!NotchItemEqual(offHand, this.fakePlayerEntity.offHand)) {
      this.writeRaw(client, 'entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: 1,
        item: offHand
      })
      this.fakePlayerEntity.offHand = offHand
    }
    // Armor
    const equipmentMap = [5, 4, 3, 2]
    for (let i = 0; i < 4; i++) {
      // Armor slots start at 5
      const armorItem = this.bot.inventory.slots[i + 5] ? this.pItem.toNotch(this.bot.inventory.slots[i + 5]) : NoneItemData
      if (NotchItemEqual(armorItem, this.fakePlayerEntity.armor[i])) continue
      this.writeRaw(client, 'entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: equipmentMap[i],
        item: armorItem
      })
      this.fakePlayerEntity.armor[i] = armorItem
    }
  }

  private writePlayerEntity(client: ServerClient) {
    this.writeRaw(client, 'named_entity_spawn', {
      entityId: FakePlayer.fakePlayerId,
      playerUUID: this.uuid,
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      metadata: [{
        key: 5, type: 6, value: true // No gravity
      }]
    })

    this.updateEquipment(client)

    this.writeRaw(client, 'entity_look', {
      entityId: FakePlayer.fakePlayerId,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    })

    this.writeRaw(client, 'entity_head_rotation', {
      entityId: FakePlayer.fakePlayerId,
      headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
    })
  }

  private spawn(client: ServerClient) {
    // if (this.isSpawned) throw new Error('Already spawned')
    if (client.uuid in this.isSpawnedMap && this.isSpawnedMap[client.uuid]) console.warn('Already spawned')
    // this.initListener()
    this.writePlayerInfo(client).then(() => {
      this.writePlayerEntity(client)
      this.isSpawnedMap[client.uuid] = true
    }).catch(console.error)
  }

  private writeDestroyEntity(client: ServerClient) {
    this.writeRaw(client, 'entity_destroy', {
      entityIds: [FakePlayer.fakePlayerId]
    })
  }

  private deSpawn(client: ServerClient) {
    // if (!this.isSpawned) throw new Error('Nothing to de-spawn player not spawned')
    if (client.uuid in this.isSpawnedMap) {
      // if (!this.isSpawnedMap[client.uuid]) console.warn('Nothing to de-spawn player not spawned')
    }
    this.writeDestroyEntity(client)
    this.writeRaw(client, 'player_info', {
      action: 4,
      data: [{
        UUID: this.uuid
      }]
    })
    this.isSpawnedMap[client.uuid] = false
  }
}

export class FakeSpectator {
  bot: Bot
  clientsInCamera: Record<string, { status: boolean, cleanup: () => void }> = {}
  positionTransformer?: IPositionTransformer
  constructor(bot: Bot, options: { positionTransformer?: IPositionTransformer } = {}) {
    this.bot = bot
    this.positionTransformer = options.positionTransformer
  }

  private writeRaw(client: ServerClient | Client, name: string, data: any) {
    if (this.positionTransformer) {
      const result = this.positionTransformer.onSToCPacket(name, data)
      if (!result) return
      if (result && result.length > 1) return
      const [transformedName, transformedData] = result[0]
      client.write(transformedName, transformedData)
    } else {
      client.write(name, data)
    }
  }

  private addToTab(client: ServerClient | Client, gamemode: number, name: string) {
    this.writeRaw(client, 'player_info', {
      action: 0,
      data: [{
        UUID: client.uuid,
        name,
        properties: [],
        gamemode,
        ping: 0
      }]
    })
  }

  private makeInvisible(client: Client | ServerClient) {
    this.writeRaw(client, 'entity_metadata', {
      entityId: this.bot.entity.id,
      metadata: [
      //   {
      //   key: 13, type: 0, value: 127
      // }, 
      {
        key: 0, type: 0, value: 32
      }]
    })
  }

  private makeVisible(client: ServerClient | Client) {
    this.writeRaw(client, 'entity_metadata', {
      entityId: this.bot.entity.id,
      metadata: [{
        key: 0,
        type: 0,
        value: 0
      }]
    })
  }

  makeSpectator(client: ServerClient) {
    this.writeRaw(client, 'abilities', {
      flags: 7,
      flyingSpeed: 0.05000000074505806,
      walkingSpeed: 0.10000000149011612
    })
    this.writeRaw(client, 'player_info', {
      action: 1,
      data: [{
        UUID: client.uuid,
        gamemode: 3
      }]
    })
    this.writeRaw(client, 'game_state_change', {
      reason: 3, // https://wiki.vg/index.php?title=Protocol&oldid=14204#Change_Game_State
      gameMode: 3
    })
    this.makeInvisible(client)
    this.addToTab(client, 3, client.username)
  }
  revertToNormal(client: ServerClient) {
    this.writeRaw(client, 'position', {
      ...this.bot.entity.position,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    })
    const a = packetAbilities(this.bot)
    this.writeRaw(client, a.name, a.data)
    this.writeRaw(client, 'game_state_change', {
      reason: 3, // https://wiki.vg/index.php?title=Protocol&oldid=14204#Change_Game_State
      gameMode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode)
    })
    this.writeRaw(client, a.name, a.data)
    this.addToTab(client, 0, client.username)
    this.makeVisible(client)
  }
  tpToOrigin(client: Client | ServerClient) {
    this.writeRaw(client, 'position', {
      ...(this.bot.entity.position)
    })
  }
  makeViewingBotPov(client: Client | ServerClient) {
    if (this.clientsInCamera[client.uuid]) {
      if (this.clientsInCamera[client.uuid].status) {
        console.warn('Already in the camera', client.username)
        return false
      }
    }
    this.writeRaw(client, 'camera', {
      cameraId: FakePlayer.fakePlayerId
    })
    const updatePos = () => {
      this.writeRaw(client, 'position', {
        ...this.bot.entity.position,
        yaw: 180 - (this.bot.entity.yaw * 180) / Math.PI,
        pitch: -(this.bot.entity.pitch * 180) / Math.PI,
        onGround: this.bot.entity.onGround
      })
    }
    updatePos()
    const onMove = () => updatePos()
    const cleanup = () => {
      this.bot.removeListener('move', onMove)
      this.bot.removeListener('end', cleanup)
      client.removeListener('end', cleanup)
    }
    this.bot.on('move', onMove)
    this.bot.once('end', cleanup)
    client.once('end', cleanup)
    this.clientsInCamera[client.uuid] = { status: true, cleanup: cleanup }
    return true
  }
  revertPov(client: Client | ServerClient) {
    if (this.clientsInCamera[client.uuid]) {
      if (!this.clientsInCamera[client.uuid].status) {
        // console.warn('Not in camera cannot revert', client.username)
        return false
      }
    } else {
      // console.warn('Not in camera cannot revert', client.username)
      return false
    }
    this.writeRaw(client, 'camera', {
      cameraId: this.bot.entity.id
    })
    this.clientsInCamera[client.uuid].cleanup()
    this.clientsInCamera[client.uuid].status = false
    this.clientsInCamera[client.uuid].cleanup = () => { }
    return true
  }
}

export async function sleep(ms: number) {
  await timeoutPromise(ms)
}

function gamemodeToNumber(str: GameState["gameMode"]) {
  if (str === 'survival') {
    return 0
  } else if (str === 'creative') {
    return 1
  } else if (str === 'adventure') {
    return 2
  } else if (str === 'spectator') {
    return 3
  }
}

function createTask() {
  const task: {
    done: boolean,
    promise: Promise<void>,
    cancel: Function,
    finish: Function
  } = {
    done: false,
    promise: new Promise(() => { }),
    cancel: () => ({}),
    finish: () => ({})
  }
  task.promise = new Promise((resolve, reject) => {
    task.cancel = (err: any) => {
      if (!task.done) {
        task.done = true
        reject(err)
      }
    }
    task.finish = (result: any) => {
      if (!task.done) {
        task.done = true
        resolve(result)
      }
    }
  })
  return task
}

export function onceWithCleanup(emitter: EventEmitter, event: string, { timeout = 0, checkCondition = undefined }: { timeout?: number, checkCondition?: Function } = {}): Promise<unknown> {
  const task = createTask()

  const onEvent = (...data: any[]) => {
    if (typeof checkCondition === 'function' && !checkCondition(...data)) {
      return
    }

    task.finish(data)
  }

  emitter.addListener(event, onEvent)

  if (typeof timeout === 'number' && timeout > 0) {
    // For some reason, the call stack gets lost if we don't create the error outside of the .then call
    const timeoutError = new Error(`Event ${event} did not fire within timeout of ${timeout}ms`)
    timeoutPromise(timeout).then(() => {
      if (!task.done) {
        task.cancel(timeoutError)
      }
    })
  }

  task.promise.finally(() => emitter.removeListener(event, onEvent)).catch(err => { })

  return task.promise
}
