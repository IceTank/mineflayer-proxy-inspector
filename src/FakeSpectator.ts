import { Client, ServerClient } from "minecraft-protocol";
import { Bot } from "mineflayer";
import { packetAbilities } from "@icetank/mcproxy";
import { IPositionTransformer } from "@icetank/mcproxy/lib/positionTransformer";
const debug = require('debug');
import { FakePlayer } from "./FakePlayer";

export class FakeSpectator {
  static debugLog = debug('mcproxy:FakeSpectator');
  bot: Bot;
  clientsInCamera: Record<string, { status: boolean; cleanup: () => void; }> = {};
  positionTransformer?: IPositionTransformer;
  constructor(bot: Bot, options: { positionTransformer?: IPositionTransformer; } = {}) {
    this.bot = bot;
    this.positionTransformer = options.positionTransformer;
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

  private addToTab(client: ServerClient | Client, gamemode: number, name: string) {
    FakeSpectator.debugLog('Adding to tab', client.username, gamemode, name);
    // @TODO: Fix this
    return 
    this.write(client, 'player_info', {
      action: 63,
      data: [{
        UUID: client.uuid,
        name,
        properties: [],
        player: {
          name,
          properties: []
        },
        gamemode,
        ping: 0
      }]
    });
  }

  private makeInvisible(client: Client | ServerClient) {
    FakeSpectator.debugLog('Making invisible', client.username);
    return
    // @TODO: Fix this
    this.write(client, 'entity_metadata', {
      entityId: this.bot.entity.id,
      metadata: [{ key: 0, type: 0, value: 32 }]
    });
  }

  private makeVisible(client: ServerClient | Client) {
    FakeSpectator.debugLog('Making visible', client.username);
    return
    // @TODO: Fix this
    this.write(client, 'entity_metadata', {
      entityId: this.bot.entity.id,
      metadata: [{
        key: 0,
        type: 0,
        value: 0
      }]
    });
  }

  makeSpectator(client: ServerClient) {
    FakeSpectator.debugLog('Making spectator', client.username);
    this.write(client, 'abilities', {
      flags: 7,
      flyingSpeed: 0.05000000074505806,
      walkingSpeed: 0.10000000149011612
    });
    // @TODO: Fix this
    /* this.write(client, 'player_info', {
      action: 1,
      data: [{
        UUID: client.uuid,
        gamemode: 3
      }]
    }); */
    this.write(client, 'game_state_change', {
      reason: 3,
      gameMode: 3
    });
    this.makeInvisible(client);
    this.addToTab(client, 3, client.username);
  }
  revertToNormal(client: ServerClient) {
    FakeSpectator.debugLog('Reverting to normal', client.username);
    this.write(client, 'position', {
      ...this.bot.entity.position,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround
    });
    const a = packetAbilities(this.bot);
    this.write(client, a.name, a.data);
    this.write(client, 'game_state_change', {
      reason: 3,
      gameMode: FakePlayer.gameModeToNotchian(this.bot.game.gameMode)
    });
    this.write(client, a.name, a.data);
    this.addToTab(client, 0, client.username);
    this.makeVisible(client);
  }
  tpToOrigin(client: Client | ServerClient) {
    FakeSpectator.debugLog('Teleporting to origin', client.username);
    this.write(client, 'position', {
      ...(this.bot.entity.position)
    });
  }
  makeViewingBotPov(client: Client | ServerClient) {
    FakeSpectator.debugLog('Making viewing bot pov', client.username);
    if (this.clientsInCamera[client.uuid]) {
      if (this.clientsInCamera[client.uuid].status) {
        console.warn('Already in the camera', client.username);
        return false;
      }
    }
    this.write(client, 'camera', {
      cameraId: FakePlayer.fakePlayerId
    });
    const updatePos = () => {
      this.write(client, 'position', {
        ...this.bot.entity.position,
        yaw: 180 - (this.bot.entity.yaw * 180) / Math.PI,
        pitch: -(this.bot.entity.pitch * 180) / Math.PI,
        onGround: this.bot.entity.onGround
      });
    };
    updatePos();
    const onMove = () => updatePos();
    const cleanup = () => {
      this.bot.removeListener('move', onMove);
      this.bot.removeListener('end', cleanup);
      client.removeListener('end', cleanup);
    };
    this.bot.on('move', onMove);
    this.bot.once('end', cleanup);
    client.once('end', cleanup);
    this.clientsInCamera[client.uuid] = { status: true, cleanup: cleanup };
    return true;
  }
  revertPov(client: Client | ServerClient) {
    FakeSpectator.debugLog('Reverting pov', client.username);
    if (this.clientsInCamera[client.uuid]) {
      if (!this.clientsInCamera[client.uuid].status) {
        // console.warn('Not in camera cannot revert', client.username)
        return false;
      }
    } else {
      // console.warn('Not in camera cannot revert', client.username)
      return false;
    }
    this.write(client, 'camera', {
      cameraId: this.bot.entity.id
    });
    this.clientsInCamera[client.uuid].cleanup();
    this.clientsInCamera[client.uuid].status = false;
    this.clientsInCamera[client.uuid].cleanup = () => { };
    return true;
  }
}
