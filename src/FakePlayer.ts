import { Client, ServerClient } from "minecraft-protocol";
import { Bot } from "mineflayer";
import { Item as ItemType } from "prismarine-item";
import Item from "prismarine-item";
const fetch = require('node-fetch');
import { IPositionTransformer } from "@icetank/mcproxy/lib/positionTransformer";
import { FakeEntity, NoneItemData } from "./util";
const debug = require('debug');

export class FakePlayer {
  static debugLog = debug('mcproxy:FakePlayer');
  name: string;
  uuid: string;
  skinLookup: boolean;
  bot: Bot;
  fakePlayerEntity: FakeEntity;
  static fakePlayerId: number = 9999;
  listenerMove: () => void = () => { };
  listenerForceMove: () => void = () => { };
  listenerPhysics: () => void = () => { };
  listenerInventory: () => void = () => { };
  listenerWorldLeave: () => void = () => { };
  listenerWorldJoin: () => void = () => { };
  pItem: typeof ItemType;
  connectedClients: ServerClient[];
  private isSpawnedMap: Record<string, boolean> = {};
  private positionTransformer: IPositionTransformer | undefined;
  constructor(bot: Bot, options: { username?: string; uuid?: string; skinLookup?: boolean; positionTransformer?: IPositionTransformer; } = {}) {
    this.name = options.username ?? 'Player';
    this.uuid = options.uuid ?? 'a01e3843-e521-3998-958a-f459800e4d11';
    this.skinLookup = options.skinLookup ?? true;
    this.bot = bot;
    this.fakePlayerEntity = new FakeEntity(bot.entity.position.clone(), bot.entity.yaw, bot.entity.pitch);
    this.pItem = Item(bot.version);
    this.initListener();
    this.connectedClients = [];
    this.positionTransformer = options.positionTransformer;
  }

  static gameModeToNotchian(gamemode: string): 1 | 0 | 2 {
    switch (gamemode) {
      case ('survival'):
        return 0;
      case ('creative'):
        return 1;
      case ('adventure'):
        return 2;
      default:
        return 0;
    }
  }

  private write(client: ServerClient | Client, name: string, data: any) {
    if (this.positionTransformer) {
      const result = this.positionTransformer.onSToCPacket(name, data);
      if (!result) return;
      if (result && result.length > 1) return;
      const [transformedName, transformedData] = result[0];
      client.write(transformedName, transformedData);
    } else {
      client.write(name, data);
    }
  }

  private initListener() {
    const writeIfSpawned = (name: string, data: Object) => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return;
        this.write(c, name, data);
      });
    };
    this.listenerMove = () => {
      // From flying-squid updatePosition.js 
      // known position is very important because the diff (/delta) send to players is floored hence is not precise enough
      // storing the known position allows to compensate next time a diff is sent
      // without the known position, the error accumulate fast and player position is incorrect from the point of view
      // of other players
      // const knownPosition = this.fakePlayerEntity.knownPosition
      const position = this.bot.entity.position;

      let entityPosition = position; // 1.12.2 Specific   
      this.fakePlayerEntity.knownPosition = position;
      this.fakePlayerEntity.onGround = this.bot.entity.onGround;
      this.fakePlayerEntity.yaw = this.bot.entity.yaw;
      this.fakePlayerEntity.pitch = this.bot.entity.pitch;
      writeIfSpawned('entity_teleport', {
        entityId: FakePlayer.fakePlayerId,
        x: entityPosition.x,
        y: entityPosition.y,
        z: entityPosition.z,
        yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
        pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
        // onGround: this.bot.entity.onGround
        onGround: false
      });
      writeIfSpawned('entity_look', {
        entityId: FakePlayer.fakePlayerId,
        yaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127),
        pitch: -Math.floor(((this.bot.entity.pitch / Math.PI) * 128) % 256),
        onGround: false
      });
      writeIfSpawned('entity_head_rotation', {
        entityId: FakePlayer.fakePlayerId,
        headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
      });
    };
    this.listenerForceMove = () => {
      this.fakePlayerEntity.knownPosition = this.bot.entity.position;
      this.fakePlayerEntity.yaw = this.bot.entity.yaw;
      this.fakePlayerEntity.pitch = this.bot.entity.pitch;

      writeIfSpawned('entity_teleport', {
        entityId: 9999,
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y,
        z: this.bot.entity.position.z,
        yaw: this.bot.entity.yaw,
        pitch: this.bot.entity.pitch,
        onGround: this.bot.entity.onGround
      });
    };
    this.listenerInventory = () => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return;
        this.writeFakePlayerEquipment(c);
      });
    };
    this.listenerWorldLeave = () => {
      const timeout = setTimeout(() => {
        this.bot._client.off('position', this.listenerWorldJoin);
      }, 5000);
      this.bot._client.once('position', () => {
        clearTimeout(timeout);
        this.listenerWorldJoin();
      });
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return;
        this.writeDestroyEntity(c);
      });
    };
    this.listenerWorldJoin = () => {
      this.connectedClients.forEach(c => {
        if (!this.isSpawnedMap[c.uuid]) return;
        this.writePlayerEntity(c);
      });
    };
    this.bot.on('move', this.listenerMove);
    // setInterval(this.listenerMove.bind(this), 50)
    this.bot.on('forcedMove', this.listenerForceMove);
    // @ts-ignore
    // TODO: Fix this
    // this.bot.inventory.on('updateSlot', this.listenerInventory);
    // this.bot._client.on('mcproxy:heldItemSlotUpdate', () => {
    //   if (this.listenerInventory) this.listenerInventory();
    // });
    this.bot.on('respawn', this.listenerWorldLeave);
  }

  register(client: ServerClient) {
    if (!this.connectedClients.includes(client)) {
      this.connectedClients.push(client);
      this.spawn(client);
    }
  }

  unregister(client: ServerClient) {
    this.connectedClients = this.connectedClients.filter(c => c !== client);
    this.deSpawn(client);
  }

  destroy() {
    this.bot.removeListener('move', this.listenerMove);
    this.bot.removeListener('forcedMove', this.listenerForceMove);
    if (this.listenerInventory) {
      // @ts-ignore
      this.bot.inventory.removeListener('updateSlot', this.listenerInventory);
    }
    this.bot.removeListener('respawn', this.listenerWorldLeave);
  }

  async writePlayerInfo(client: ServerClient) {
    FakePlayer.debugLog('Sending player info', this.uuid);
    // console.info('Sending request', `https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`)
    let properties = [];
    if (this.skinLookup) {
      let response;
      try {
        response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${this.uuid}?unsigned=false`);
        const p = await response.json() as any;
        properties = p?.properties ?? [];
        if (properties?.length !== 1) {
          console.warn('Skin lookup failed for', this.uuid);
        }
      } catch (err) {
        // console.error('Skin lookup failed', err, 'UUID:', this.uuid)
      }
    }
    // console.info('Player profile', p)
    this.write(client, 'player_info', {
      action: client.version === '1.12.2' ? 0 : 63,
      data: [{
        UUID: this.uuid,
        uuid: this.uuid,
        name: this.name,
        properties: properties,
        gamemode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode),
        player: {
          name: this.name,
          properties: []
        },
        ping: 0,
        listed: true
      }]
    });
  }

  writeFakePlayerEquipment(client: ServerClient) {
    FakePlayer.debugLog('Sending player equipment', this.uuid);
    // const objectEqual = (item1?: object, item2?: object) => {
    //   item1 = item1 ?? {}
    //   item2 = item2 ?? {}
    //   return JSON.stringify(item1) === JSON.stringify(item2)
    // }
    this.bot.updateHeldItem();
    const mainHand = this.bot.heldItem ? this.pItem.toNotch(this.bot.heldItem) : NoneItemData;
    const offHand = this.bot.inventory.slots[45] ? this.pItem.toNotch(this.bot.inventory.slots[45]) : NoneItemData;
    // Main hand
    this.write(client, 'entity_equipment', {
      entityId: FakePlayer.fakePlayerId,
      slot: 0,
      item: mainHand
    });
    this.fakePlayerEntity.mainHand = mainHand;
    // Off-Hand
    this.write(client, 'entity_equipment', {
      entityId: FakePlayer.fakePlayerId,
      slot: 1,
      item: offHand
    });
    this.fakePlayerEntity.offHand = offHand;
    // Armor
    const equipmentMap = [5, 4, 3, 2];
    for (let i = 0; i < 4; i++) {
      // Armor slots start at 5
      const armorItem = this.bot.inventory.slots[i + 5] ? this.pItem.toNotch(this.bot.inventory.slots[i + 5]) : NoneItemData;
      this.write(client, 'entity_equipment', {
        entityId: FakePlayer.fakePlayerId,
        slot: equipmentMap[i],
        item: armorItem
      });
      this.fakePlayerEntity.armor[i] = armorItem;
    }
  }

  private writePlayerEntity(client: ServerClient) {
    FakePlayer.debugLog('Sending player entity', this.uuid);
    const metadata = []
    if (client.version === '1.12.2') {
      metadata.push({
        key: 5, type: 6, value: true // No gravity
      })
    } else {
      metadata.push({
        key: 17, type: 'byte', value: 127 // Main hand ?
      })
    }
    this.write(client, 'named_entity_spawn', {
      entityId: FakePlayer.fakePlayerId,
      playerUUID: this.uuid,
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      metadata
    });

    // TODO: Fix this
    // this.writeFakePlayerEquipment(client);

    this.write(client, 'entity_look', {
      entityId: FakePlayer.fakePlayerId,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    });

    this.write(client, 'entity_head_rotation', {
      entityId: FakePlayer.fakePlayerId,
      headYaw: -(Math.floor(((this.bot.entity.yaw / Math.PI) * 128 + 255) % 256) - 127)
    });
  }

  private spawn(client: ServerClient) {
    // if (this.isSpawned) throw new Error('Already spawned')
    if (client.uuid in this.isSpawnedMap && this.isSpawnedMap[client.uuid]) console.warn('Already spawned');
    // this.initListener()
    this.writePlayerInfo(client).then(() => {
      this.writePlayerEntity(client);
      this.isSpawnedMap[client.uuid] = true;
    }).catch(console.error);
  }

  private writeDestroyEntity(client: ServerClient) {
    FakePlayer.debugLog('Destroying player entity', this.uuid);
    this.write(client, 'entity_destroy', {
      entityIds: [FakePlayer.fakePlayerId]
    });
  }

  private writeRemovePlayer(client: ServerClient) {
    if (client.version !== '1.12.2') {
      this.write(client, 'player_remove', {
        players: [this.uuid]
      })
    } else {
      this.write(client, 'player_info', {
        action: 4,
        data: [{
          UUID: this.uuid
        }]
      });
    }
  }

  private deSpawn(client: ServerClient) {
    FakePlayer.debugLog('De-spawning player', this.uuid);
    // if (!this.isSpawned) throw new Error('Nothing to de-spawn player not spawned')
    if (client.uuid in this.isSpawnedMap) {
      if (!this.isSpawnedMap[client.uuid]) console.warn('Nothing to de-spawn player not spawned')
    }
    this.writeDestroyEntity(client);
    this.writeRemovePlayer(client);
    
    this.isSpawnedMap[client.uuid] = false;
  }
}
