import { Vec3 } from "vec3";
import { ServerClient } from "minecraft-protocol";
import { Bot } from "mineflayer";
import { performance } from "perf_hooks";

class FakeEntity {
  knownPosition: Vec3
  lastSendPos: number
  yaw: number
  pitch: number
  oldYaw: number
  oldPitch: number
  onGround: boolean
  constructor(pos: Vec3, yaw: number, pitch: number) {
    this.knownPosition = pos
    this.yaw = yaw
    this.pitch = pitch
    this.oldYaw = yaw
    this.oldPitch = pitch
    this.onGround = true
    this.lastSendPos = performance.now()
  }
}

export class FakePlayer {
  name: string
  uuid: string
  bot: Bot
  client: ServerClient
  fakePlayerEntity: FakeEntity
  static fakePlayerId: number = 9999
  listenerMove?: () => void
  listenerForceMove?: () => void
  listenerPhysics?: () => void
  constructor(bot: Bot, client: ServerClient, options: {username?: string, uuid?: string} = {}) {
    this.name = options.username ?? 'Player'
    this.uuid = options.uuid ?? 'a01e3843-e521-3998-958a-f459800e4d11'
    this.bot = bot
    this.client = client
    this.fakePlayerEntity = new FakeEntity(bot.entity.position.clone(), bot.entity.yaw, bot.entity.pitch) 
    this._listenToBot()
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

  _listenToBot() {
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
          this.client.write('entity_teleport', {
            entityId: FakePlayer.fakePlayerId,
            x: entityPosition.x,
            y: entityPosition.y,
            z: entityPosition.z,
            yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
            pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
            onGround: this.bot.entity.onGround
          })
          this.fakePlayerEntity.knownPosition = position
          this.fakePlayerEntity.onGround = this.bot.entity.onGround
          this.fakePlayerEntity.yaw = this.bot.entity.yaw
          this.fakePlayerEntity.pitch = this.bot.entity.pitch
          this.fakePlayerEntity.lastSendPos = performance.now()
        } else if (!lookChanged) {
          // 1.12.2 specific
          const delta = diff.scaled(32).scaled(128).floored()
          this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
          this.client.write('rel_entity_move', {
            entityId: FakePlayer.fakePlayerId,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            onGround: this.bot.entity.onGround
          })
          this.fakePlayerEntity.knownPosition = position
          this.fakePlayerEntity.onGround = this.bot.entity.onGround
        } else if (lookChanged) {
          // 1.12.2 specific
          const delta = diff.scaled(32).scaled(128).floored()
          this.fakePlayerEntity.knownPosition = this.bot.entity.position.plus(delta.scaled(1 / 32 / 128))
          this.client.write('entity_move_look', {
            entityId: FakePlayer.fakePlayerId,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
            pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
            onGround: this.bot.entity.onGround
          })
          this.client.write('entity_head_rotation', {
            entityId: FakePlayer.fakePlayerId,
            headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
          })
          this.fakePlayerEntity.knownPosition = position
          this.fakePlayerEntity.onGround = this.bot.entity.onGround
          this.fakePlayerEntity.yaw = this.bot.entity.yaw
          this.fakePlayerEntity.pitch = this.bot.entity.pitch
        }
      } else {
        const { yaw, pitch, onGround } = this.bot.entity
        if (yaw === this.fakePlayerEntity.yaw && pitch === this.fakePlayerEntity.pitch) return
        this.client.write('entity_look', {
          entityId: FakePlayer.fakePlayerId,
          yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
          pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
          onGround: this.bot.entity.onGround
        })
        this.fakePlayerEntity.onGround = onGround
        this.fakePlayerEntity.yaw = yaw
        this.fakePlayerEntity.pitch = pitch
        this.client.write('entity_head_rotation', {
          entityId: FakePlayer.fakePlayerId,
          headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
        })
      }
    }
    this.listenerForceMove = () => {
      console.info('forcedMove')
      this.client.write('entity_teleport', {
        entityId: 9999,
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y,
        z: this.bot.entity.position.z,
        yaw: this.bot.entity.yaw,
        pitch: this.bot.entity.pitch,
        onGround: this.bot.entity.onGround
      })
      this.fakePlayerEntity.knownPosition = this.bot.entity.position
      this.fakePlayerEntity.yaw = this.bot.entity.yaw
      this.fakePlayerEntity.pitch = this.bot.entity.pitch
    }
    this.bot.on('move', this.listenerMove)
    this.bot.on('forcedMove', this.listenerForceMove)
  }

  destroy() {
    if (this.listenerMove) this.bot.removeListener('move', this.listenerMove)
    if (this.listenerForceMove) this.bot.removeListener('forcedMove', this.listenerForceMove)
  }

  writePlayerInfo() {
    this.client.write('player_info', {
      action: 0,
      data: [{
        UUID: this.uuid,
        name: this.name,
        properties: [],
        gamemode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode),
        ping: 0
      }]
    })
  }

  writePlayerEntity() {
    this.client.write('named_entity_spawn', {
      entityId: FakePlayer.fakePlayerId,
      playerUUID: this.uuid,
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      metadata: []
    })

    this.client.write('entity_look', {
      entityId: FakePlayer.fakePlayerId,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    })
  }

  spawn() {
    this.writePlayerInfo()
    this.writePlayerEntity()
  }
}

export class FakeClient {
  client: ServerClient
  constructor(client: ServerClient) {
    this.client = client
  }
  makeSpectator() {
    this.client.write('abilities', {
      flags: 7,
      flyingSpeed: 0.05000000074505806,
      walkingSpeed: 0.10000000149011612
    })
    this.client.write('player_info', {
      action: 1,
      data: {
        UUID: this.client.uuid,
        gamemode: 3
      }
    })
  }
}