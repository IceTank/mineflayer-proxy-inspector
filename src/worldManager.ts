import path from "path";
import fs from 'fs'
import { Vec3, default as VectorBuilder } from 'vec3'
import { Packet, PacketMiddleware } from "@rob9315/mcproxy";
import { Client } from 'minecraft-protocol'
import { SmartBuffer } from 'smart-buffer';
import { setTimeout } from 'timers/promises'
const { SpiralIterator2d } = require("prismarine-world").iterators
import { default as PChat } from 'prismarine-chat'
const ChatMessage = PChat('1.12.2')

const MAX_CHUNK_DATA_LENGTH = 31598;

export class WorldManager {
  savePath: string
  worlds: Record<string, any> = {}
  players: Record<string, ManagedPlayer> = {}
  constructor(savePath: string) {
    this.savePath = savePath
    setInterval(() => {
      this.onTick()
    }, 500)
  }

  onStorageBuilder() {
    return ({ version, worldName }: { version: string, worldName: string }) => {
      worldName = worldName.replace(/:/g, '_')
      if (!(worldName in this.worlds)) {
        const Anvil = require('prismarine-provider-anvil').Anvil(version)
        const worldPath = path.join(this.savePath, worldName, 'region')
        if (!fs.existsSync(worldPath)) fs.mkdirSync(worldPath, { recursive: true })
        this.worlds[worldName] = new Anvil(worldPath)
      }
      return this.worlds[worldName]
    }
  }

  async getChunk(dimension: string, chunkX: number, chunkZ: number) {
    if (!(dimension in this.worlds)) return null
    return await this.worlds[dimension].load(chunkX * 16, chunkZ * 16)
  }

  /**
   * Returns the chunks that should be loaded for a given position and view distance
   * @param chunkViewDistance View distance as number off blocks
   * @param pos Player position
   */
  getChunksForPosition(chunkViewDistance: number, pos: Vec3) {
    const spiralIterator = new SpiralIterator2d(pos.scaled(1 / 16).floored(), chunkViewDistance)
    const list: Vec3[] = []
    spiralIterator.next() // First one is always the starting position
    let next = spiralIterator.next()
    while (next) {
      list.push(next.scaled(16))
      next = spiralIterator.next()
    }
    return list
  }

  setClientView(client: Client, chunkViewDistance: number) {
    const managedPlayer = this.players[client.uuid]
    if (!managedPlayer) {
      console.info('Player not found')
      return
    }
    managedPlayer.chunkViewDistance = chunkViewDistance
    managedPlayer.isActive = true
  }

  reloadClientChunks(client: Client, chunkRadius: number = 2) {
    const managedPlayer = this.players[client.uuid]
    if (!managedPlayer) {
      console.info('Player not found')
      return
    }
    managedPlayer.reloadChunks(chunkRadius)
  }

  disableClientExtension(client: Client) {
    const managedPlayer = this.players[client.uuid]
    if (!managedPlayer) {
      console.info('Player not found')
      return
    }
    managedPlayer.chunkViewDistance = 6
    managedPlayer.isActive = false
  }

  newManagedPlayer(client: Client, pos: Vec3) {
    if (!(client.uuid in this.players)) {
      this.players[client.uuid] = new ManagedPlayer(this, client, pos)
    }
    client.once('end', () => {
      this.players[client.uuid]?.remove()
      delete this.players[client.uuid]
    })
    return this.players[client.uuid]
  }

  onTick() {
    Object.values(this.players).forEach(p => {
      p.onTick()
    })
  }
}

class ManagedPlayer {
  worldManager: WorldManager
  currentWorld: string = 'minecraft_overworld'
  /** Loaded chunks in in game coordinates */
  loadQueue = new Set<string>()
  client: Client
  loadedChunks: Vec3[] = []
  isActive: boolean = false
  chunkViewDistance: number = 5
  pos: Vec3

  private currentlyExpanding = false

  constructor(worldManager: WorldManager, client: Client, pos: Vec3) {
    this.worldManager = worldManager
    this.client = client
    this.pos = pos
  }

  getMiddlewareToClient() {
    const inspector_toClientMiddlewareMapListener: PacketMiddleware = (info, pclient, data, canceler) => {
      if (canceler.isCanceled) return
      if (!this.isActive) return
      if (info.bound !== 'client') return
      if (info.meta.name === 'map_chunk') {
        const chunkPos = new Vec3(data.x, 0, data.z).scaled(16)
        if (!this.loadedChunks.find(l => l.equals(chunkPos))) {
          this.loadedChunks.push()
        }
      } else if (info.meta.name === 'unload_chunk') {
        const pos = new Vec3(data.chunkX, 0, data.chunkZ).scaled(16)
        if (this.isWithinViewDistance(pos)) return canceler()
        this.loadedChunks = this.loadedChunks.filter(v => !v.equals(pos))
      }
    }
    return [inspector_toClientMiddlewareMapListener]
  }

  getMiddlewareToServer() {

  }

  private updateLoadQueue() {
    const poss = this.worldManager.getChunksForPosition(this.chunkViewDistance, this.pos)
    for (const inRange of poss) {
      let found = false
      for (const loaded of this.loadedChunks) {
        if (loaded.equals(inRange)) {
          found = true
          break
        }
      }
      if (!found) {
        const hash = inRange.floored().toString()
        if (!this.loadQueue.has(hash)) this.loadQueue.add(hash)
      }
    }
  }

  isWithinViewDistance(pos: Vec3) {
    return pos.manhattanDistanceTo(this.pos) < 16 * this.chunkViewDistance
  }

  reloadChunks(chunkRadius: number = 2) {
    this.loadQueue.clear()
    this.loadedChunks = this.loadedChunks.filter(c => {
      return this.pos.distanceTo(c) < chunkRadius * 16
    })
  }

  async expand() {
    if (this.currentlyExpanding) return
    this.currentlyExpanding = true
    const world = this.worldManager.worlds[this.currentWorld]
    if (!world) {
      console.warn('World currently not loaded')
      this.currentlyExpanding = false
      return
    }
    // console.info('Loaded chunks', this.loadedChunks)
    let next = Array.from(this.loadQueue).map(hash => VectorBuilder(hash)).sort((a, b) => a.distanceTo(this.pos) - b.distanceTo(this.pos))[0]
    while (next) {
      debugger
      const { x, z } = next.scaled(1 / 16).floored()
      const column = await world.load(x, z)
      if (column) {
        if (!this.loadedChunks.find(l => l.equals(next))) {
          this.loadedChunks.push(next)
          console.info('Generating chunk for ', next.floored(), 'distance', this.pos.distanceTo(next))
          const packets = chunkColumnToPackets(world, { chunkX: x, chunkZ: z, column })
          packets.forEach(p => {
            this.client.write(p[0], p[1])
          })
          await setTimeout(1)
        }
      }
      this.loadQueue.delete(next.toString())
      next = Array.from(this.loadQueue).map(hash => VectorBuilder(hash)).sort((a, b) => a.distanceTo(this.pos) - b.distanceTo(this.pos))[0]
    }
    this.currentlyExpanding = false
  }

  remove() {

  }

  onTick() {
    if (!this.isActive) return
    this.updateLoadQueue()
    this.expand().catch(console.error)
  }
}

function chunkColumnToPackets(
  world: any,
  { chunkX: x, chunkZ: z, column }: { chunkX: number; chunkZ: number; column: any },
  lastBitMask?: number,
  chunkData: SmartBuffer = new SmartBuffer(),
  chunkEntities: ChunkEntity[] = []
): Packet[] {
  let bitMask = !!lastBitMask ? column.getMask() ^ (column.getMask() & ((lastBitMask << 1) - 1)) : column.getMask();
  let bitMap = lastBitMask ?? 0b0;
  let newChunkData = new SmartBuffer();

  // blockEntities
  // chunkEntities.push(...Object.values(column.blockEntities as Map<string, ChunkEntity>));

  // checks with bitmask if there is a chunk in memory that (a) exists and (b) was not sent to the client yet
  for (let i = 0; i < 16; i++)
    if (bitMask & (0b1 << i)) {
      column.sections[i].write(newChunkData);
      bitMask ^= 0b1 << i;
      if (chunkData.length + newChunkData.length > MAX_CHUNK_DATA_LENGTH) {
        if (!lastBitMask) column.biomes?.forEach((biome: number) => chunkData.writeUInt8(biome));
        return [
          ['map_chunk', { x, z, bitMap, chunkData: chunkData.toBuffer(), groundUp: !lastBitMask, blockEntities: [] }],
          ...chunkColumnToPackets(world, { chunkX: x, chunkZ: z, column }, 0b1 << i, newChunkData),
          ...getChunkEntityPackets(world, column.blockEntities),
        ];
      }
      bitMap ^= 0b1 << i;
      chunkData.writeBuffer(newChunkData.toBuffer());
      newChunkData.clear();
    }
  if (!lastBitMask) column.biomes?.forEach((biome: number) => chunkData.writeUInt8(biome));
  return [['map_chunk', { x, z, bitMap, chunkData: chunkData.toBuffer(), groundUp: !lastBitMask, blockEntities: [] }], ...getChunkEntityPackets(world, column.blockEntities)];
}

type NbtPositionTag = { type: 'int'; value: number };
type BlockEntity = { x: NbtPositionTag; y: NbtPositionTag; z: NbtPositionTag; id: object };
type ChunkEntity = { name: string; type: string; value: BlockEntity };
function getChunkEntityPackets(world: any, blockEntities: { [pos: string]: ChunkEntity }) {
  const packets: Packet[] = [];
  for (const nbtData of Object.values(blockEntities)) {
    const {
      x: { value: x },
      y: { value: y },
      z: { value: z },
    } = nbtData.value;
    const location = { x, y, z };
    packets.push(['tile_entity_data', { location, nbtData }]);
    const block = world.getBlock(new Vec3(x, y, z));
    if (block?.name == 'minecraft:chest') {
      packets.push(['block_action', { location, byte1: 1, byte2: 0, blockId: block.type }]);
    }
  }
  return packets;
}