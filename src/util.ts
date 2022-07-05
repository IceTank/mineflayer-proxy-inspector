import { Vec3 } from "vec3";
import { ServerClient } from "minecraft-protocol";
import { Bot as VanillaBot } from "mineflayer";
import { performance } from "perf_hooks";
import { Item as ItemType, NotchItem } from "prismarine-item";
import Item from "prismarine-item";
import { packetAbilities } from "@rob9315/mcproxy";
const fetch = require('node-fetch')

type Bot = VanillaBot & { recipes: number[] }

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
  armor: Array<NotchItem|undefined>
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

export class FakePlayer {
  name: string
  uuid: string
  skinLookup: boolean
  bot: Bot
  fakePlayerEntity: FakeEntity
  static fakePlayerId: number = 9999
  listenerMove: () => void = () => {}
  listenerForceMove: () => void = () => {}
  listenerPhysics: () => void = () => {}
  listenerInventory: () => void = () => {}
  pItem: typeof ItemType
  connectedClients: ServerClient[]
  private isSpawnedMap: Record<string, boolean> = {}
  constructor(bot: Bot, options: {username?: string, uuid?: string, skinLookup?: boolean} = {}) {
    this.name = options.username ?? 'Player'
    this.uuid = options.uuid ?? 'a01e3843-e521-3998-958a-f459800e4d11'
    this.skinLookup = options.skinLookup ?? true
    this.bot = bot
    this.fakePlayerEntity = new FakeEntity(bot.entity.position.clone(), bot.entity.yaw, bot.entity.pitch) 
    this.pItem = Item(bot.version)
    this.initListener()
    this.connectedClients = []
  }

  static gameModeToNotchian(gamemode: string): 1 | 0 | 2 {
    switch(gamemode) {
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

  private initListener() {
    const writeIfSpawned = (name: string, data: Object) => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return
        c.write(name, data)
      })
    }
    this.listenerMove = () => {
      // From flying-squid updatePosition.js 
      // known position is very important because the diff (/delta) send to players is floored hence is not precise enough
      // storing the known position allows to compensate next time a diff is sent
      // without the known position, the error accumulate fast and player position is incorrect from the point of view
      // of other players
      const knownPosition = this.fakePlayerEntity.knownPosition
      const position = this.bot.entity.position
      const diff = this.bot.entity.position.minus(knownPosition)
      const maxDelta = 7 // 1.12.2 Specific

      const lookChanged = this.fakePlayerEntity.yaw !== this.bot.entity.yaw || this.fakePlayerEntity.pitch !== this.bot.entity.pitch

      if (diff.distanceTo(new Vec3(0, 0, 0)) !== 0) {
        if (diff.abs().x > maxDelta || diff.abs().y > maxDelta || diff.abs().z > maxDelta) {
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
            onGround: this.bot.entity.onGround
          })
          this.fakePlayerEntity.lastSendPos = performance.now()
        } else if (!lookChanged) {
          // 1.12.2 specific
          const delta = diff.scaled(32).scaled(128).floored()
          this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
          this.fakePlayerEntity.knownPosition = position
          this.fakePlayerEntity.onGround = this.bot.entity.onGround

          writeIfSpawned('rel_entity_move', {
            entityId: FakePlayer.fakePlayerId,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            onGround: this.bot.entity.onGround
          })
        } else if (lookChanged) {
          // 1.12.2 specific
          const delta = diff.scaled(32).scaled(128).floored()
          this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
          this.fakePlayerEntity.knownPosition = position
          this.fakePlayerEntity.onGround = this.bot.entity.onGround
          this.fakePlayerEntity.yaw = this.bot.entity.yaw
          this.fakePlayerEntity.pitch = this.bot.entity.pitch

          writeIfSpawned('entity_move_look', {
            entityId: FakePlayer.fakePlayerId,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
            pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
            onGround: this.bot.entity.onGround
          })
          writeIfSpawned('entity_head_rotation', {
            entityId: FakePlayer.fakePlayerId,
            headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
          })
        }
      } else {
        const { yaw, pitch, onGround } = this.bot.entity
        if (yaw === this.fakePlayerEntity.yaw && pitch === this.fakePlayerEntity.pitch) return
        this.fakePlayerEntity.onGround = onGround
        this.fakePlayerEntity.yaw = yaw
        this.fakePlayerEntity.pitch = pitch

        writeIfSpawned('entity_look', {
          entityId: FakePlayer.fakePlayerId,
          yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
          pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
          onGround: this.bot.entity.onGround
        })
        writeIfSpawned('entity_head_rotation', {
          entityId: FakePlayer.fakePlayerId,
          headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
        })
      }
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
    this.bot.on('move', this.listenerMove)
    this.bot.on('forcedMove', this.listenerForceMove)
    // @ts-ignore
    this.bot.inventory.on('updateSlot', this.listenerInventory)
    this.bot._client.on('mcproxy:heldItemSlotUpdate', () => {
      if (this.listenerInventory) this.listenerInventory()
    })
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
    if (this.listenerMove) this.bot.removeListener('move', this.listenerMove)
    if (this.listenerForceMove) this.bot.removeListener('forcedMove', this.listenerForceMove)
    if (this.listenerInventory) {
      // @ts-ignore
      this.bot.inventory.removeListener('updateSlot', this.listenerInventory)
    }
  }

  async writePlayerInfo(client: ServerClient) {
    // console.info('Sending request', `https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`)
    let properties = []
    if (this.skinLookup) {
      const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`)
      const p = await response.json() as any
      properties = p?.properties ?? []
      if (properties?.length !== 1) {
        console.warn('Skin lookup failed for', this.uuid)
      }
    }
    // console.info('Player profile', p)
    client.write('player_info', {
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
      client.write('entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: 0,
        item: mainHand
      })
    }
    // Off-Hand
    if (!NotchItemEqual(offHand, this.fakePlayerEntity.offHand)) {
      client.write('entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: 1,
        item: offHand
      })
    }
    // Armor
    const equipmentMap = [5, 4, 3, 2]
    for (let i = 0; i < 4; i++) {
      // Armor slots start at 5
      const armorItem = this.bot.inventory.slots[i + 5] ? this.pItem.toNotch(this.bot.inventory.slots[i + 5]) : NoneItemData
      if (NotchItemEqual(armorItem, this.fakePlayerEntity.armor[i])) continue
      client.write('entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: equipmentMap[i],
        item: armorItem
      })
    }
  }

  writePlayerEntity(client: ServerClient) {
    client.write('named_entity_spawn', {
      entityId: FakePlayer.fakePlayerId,
      playerUUID: this.uuid,
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      metadata: []
    })

    this.updateEquipment(client)
    
    client.write('entity_look', {
      entityId: FakePlayer.fakePlayerId,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    })

    client.write('entity_head_rotation', {
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

  private deSpawn(client: ServerClient) {
    // if (!this.isSpawned) throw new Error('Nothing to de-spawn player not spawned')
    if (client.uuid in this.isSpawnedMap) {
      if (!this.isSpawnedMap[client.uuid]) console.warn('Nothing to de-spawn player not spawned')
    }
    client.write('entity_destroy', {
      entityIds: [ FakePlayer.fakePlayerId ]
    })
    client.write('player_info', {
      action: 4,
      data: [{
        UUID: this.uuid
      }]
    })
    this.destroy()
    // this.isSpawned = false
    this.isSpawnedMap[client.uuid] = false
  }
}

export class FakeSpectator {
  bot: Bot
  constructor(bot: Bot) {
    this.bot = bot
  }
  makeSpectator(client: ServerClient) {
    client.write('abilities', {
      flags: 7,
      flyingSpeed: 0.05000000074505806,
      walkingSpeed: 0.10000000149011612
    })
    client.write('player_info', {
      action: 1,
      data: [{
        UUID: client.uuid,
        gamemode: 3
      }]
    })
    client.write('game_state_change', {
      reason: 3, // https://wiki.vg/index.php?title=Protocol&oldid=14204#Change_Game_State
      gameMode: 3
    })
  }
  revertToNormal(client: ServerClient) {
    client.write('position', {
      ...this.bot.entity.position,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    })
    const a = packetAbilities(this.bot)
    client.write(a.name, a.data)
    client.write('game_state_change', {
      reason: 3, // https://wiki.vg/index.php?title=Protocol&oldid=14204#Change_Game_State
      gameMode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode)
    })
  }
}
