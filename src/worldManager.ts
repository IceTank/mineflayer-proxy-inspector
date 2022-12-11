import path from "path";
import fs from 'fs'
import { Vec3, default as VectorBuilder } from 'vec3'
import { PacketMiddleware } from "@rob9315/mcproxy";
import { Client } from 'minecraft-protocol'
import { setTimeout } from 'timers/promises'
const { SpiralIterator2d } = require("prismarine-world").iterators
import { IPositionTransformer } from "@rob9315/mcproxy/lib/positionTransformer";
import { chunkColumnToPacketsWithOffset } from '@rob9315/mcproxy/lib/packets'

export class WorldManager {
  savePath: string
  worlds: Record<string, any> = {}
  players: Record<string, ManagedPlayer> = {}
  positionTransformer?: IPositionTransformer
  constructor(savePath: string, options: { positionTransformer?: IPositionTransformer } = {}) {
    this.savePath = savePath
    this.positionTransformer = options.positionTransformer
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
      this.players[client.uuid] = new ManagedPlayer(this, client, pos, this.positionTransformer)
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
  positionReference: Vec3

  private currentlyExpanding = false
  private positionTransformer?: IPositionTransformer

  constructor(worldManager: WorldManager, client: Client, positionReference: Vec3, positionTransformer?: IPositionTransformer) {
    this.worldManager = worldManager
    this.client = client
    this.positionReference = positionReference
    this.positionTransformer = positionTransformer
  }

  private writeToClientRaw(client: Client, name: string, data: any) {
    client.write(name, data)
  }

  getMiddlewareToClient() {
    const inspector_toClientMiddlewareMapListener: PacketMiddleware = ({ meta, data, isCanceled, bound }) => {
      if (isCanceled) return
      if (!this.isActive) return
      if (bound !== 'client') return
      if (meta.name === 'map_chunk') {
        const chunkPos = new Vec3(data.x, 0, data.z).scaled(16)
        if (!this.loadedChunks.find(l => l.equals(chunkPos))) {
          this.loadedChunks.push()
        }
      } else if (meta.name === 'unload_chunk') {
        const pos = new Vec3(data.chunkX, 0, data.chunkZ).scaled(16)
        if (this.isWithinViewDistance(pos)) return false
        this.loadedChunks = this.loadedChunks.filter(v => !v.equals(pos))
      }
    }
    return [inspector_toClientMiddlewareMapListener]
  }

  getMiddlewareToServer() {

  }

  private updateLoadQueue() {
    const poss = this.worldManager.getChunksForPosition(this.chunkViewDistance, this.positionReference)
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
    return pos.manhattanDistanceTo(this.positionReference) < 16 * this.chunkViewDistance
  }

  reloadChunks(chunkRadius: number = 2) {
    this.loadQueue.clear()
    this.loadedChunks = this.loadedChunks.filter(c => {
      return this.positionReference.distanceTo(c) < chunkRadius * 16
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
    let next = Array.from(this.loadQueue).map(hash => VectorBuilder(hash)).sort((a, b) => a.distanceTo(this.positionReference) - b.distanceTo(this.positionReference))[0]
    while (next) {
      const { x, z } = next.scaled(1 / 16).floored()
      const column = await world.load(x, z)
      if (column) {
        if (!this.loadedChunks.find(l => l.equals(next))) {
          this.loadedChunks.push(next)
          // console.info('Generating chunk for ', next.floored(), 'distance', this.positionReference.distanceTo(next))
          let offset
          if (this.positionTransformer) {
            offset = {
              offsetBlock: this.positionTransformer.sToC.offsetVec.clone(),
              offsetChunk: this.positionTransformer.sToC.offsetChunkVec.clone()
            }
          } else {
            offset = {
              offsetBlock: new Vec3(0, 0, 0),
              offsetChunk: new Vec3(0, 0, 0)
            }
          }
          const packets = chunkColumnToPacketsWithOffset({ chunkX: x, chunkZ: z, column }, undefined, undefined, undefined, offset)
          packets.forEach(p => {
            this.writeToClientRaw(this.client, p[0], p[1])
          })
          await setTimeout(1)
        }
      }
      this.loadQueue.delete(next.toString())
      next = Array.from(this.loadQueue).map(hash => VectorBuilder(hash)).sort((a, b) => a.distanceTo(this.positionReference) - b.distanceTo(this.positionReference))[0]
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
