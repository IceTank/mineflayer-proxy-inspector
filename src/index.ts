import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, ServerClient } from "minecraft-protocol";
import type { Server } from "minecraft-protocol";
import { FakeSpectator, FakePlayer, sendMessage, sleep, onceWithCleanup } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter, { once } from "events";
import { setTimeout } from "timers/promises";
import type { ChatMessage } from 'prismarine-chat'
import path from "path";
import fs from 'fs'
import { WorldManager } from "./worldManager";
import { Vec3 } from 'vec3'

export { sendMessage }

type allowListCallback = (username: string) => boolean

export interface ProxyOptions {
  port?: number
  motd?: string
  security?: {
    onlineMode?: boolean
    /** Optional. If not set all players are allowed to join. Either a list off players allowed to connect to the proxy or a function that returns a boolean value. */
    allowList?: string[] | allowListCallback
    kickMessage?: string
  },
  /** Link a connecting client as soon as he joins if no one else is currently controlling the proxy. Default: true */
  linkOnConnect?: boolean
  /** @deprecated use autoStartBotOnServerLogin instead */
  startOnLogin?: boolean
  /** @deprecated use botStopOnLogoff instead */
  stopOnLogoff?: boolean

  /** Automatically join the server. If false bot can be started with `{Proxy}.startBot()`. Default: true */
  botAutoStart?: boolean
  /** Stop the bot when the last person leaves the server. Default: true */
  botStopOnLogoff?: boolean
  /** Automatically start the server. If false the server can be started with `{Proxy}.startServer()` Default: true */
  serverAutoStart?: boolean
  /** Stop the server when the bot stops. Default: false */
  serverStopOnBotStop?: boolean
  /** Auto start the bot when someone joins the server when the bot is not running. Default: true */
  autoStartBotOnServerLogin?: boolean
  /** Log players joining and leaving the proxy. Default: false */
  logPlayerJoinLeave?: boolean
  /** Disconnect all connected players once the proxy bot stops. Defaults to true. If not on players will still be connected but won't receive updates from the server. */
  disconnectAllOnEnd?: boolean

  toClientMiddlewares?: PacketMiddleware[]
  toServerMiddlewares?: PacketMiddleware[]
  disabledCommands?: boolean

  positionOffset?: Vec3
}

declare module 'mineflayer' {
  interface Bot {
    proxy: {
      botIsControlling: boolean
      emitter: ProxyInspectorEmitter
      message(client: Client | ServerClient, message: string, prefix?: boolean, allowFormatting?: boolean, position?: number): void
      broadcastMessage(message: string, prefix?: boolean, allowFormatting?: boolean, position?: number): void
      botHasControl(): boolean
    }
  }
}

interface ProxyInspectorEmitter extends EventEmitter {
  on(event: 'proxyBotLostControl', listener: () => void): this
  on(event: 'proxyBotTookControl', listener: () => void): this
}

export interface InspectorProxy {
  on(event: 'clientConnect', listener: (client: Client) => void): this
  on(event: 'clientDisconnect', listener: (client: Client) => void): this
  /** Chat messages excluding proxy commands */
  on(event: 'clientChat', listener: (client: Client, message: string) => void): this
  /** All chat messages including proxy commands */
  on(event: 'clientChatRaw', listener: (client: Client, message: string) => void): this
  on(event: 'botStart', listener: (conn: Conn) => void): this
  on(event: 'botReady', listener: (conn: Conn) => void): this
  on(event: 'botEnd', listener: (conn?: Conn) => void): this
  on(event: 'serverStart', listener: () => void): this
  on(event: 'serverClose', listener: () => void): this
}

export class InspectorProxy extends EventEmitter {
  options: BotOptions
  proxyOptions: ProxyOptions
  worldManager: WorldManager
  conn?: Conn
  server: Server | undefined
  fakePlayer?: FakePlayer
  fakeSpectator?: FakeSpectator
  blockedPacketsWhenNotInControl: string[]
  proxyChatPrefix: string = '§6Proxy >>§r'
  worldSave = 'worlds'
  positionOffset?: Vec3

  constructor(options: BotOptions, proxyOptions: ProxyOptions = {}) {
    super()
    this.worldManager = new WorldManager('worlds')
    this.options = {
      ...options,
      // @ts-ignore
      storageBuilder: this.worldManager.onStorageBuilder()
    }
    this.proxyOptions = proxyOptions
    this.server = undefined
    this.blockedPacketsWhenNotInControl = ['abilities', 'position']

    this.proxyOptions.botAutoStart ??= true
    this.proxyOptions.botStopOnLogoff ??= true
    this.proxyOptions.serverAutoStart ??= true
    this.proxyOptions.serverStopOnBotStop ??= false
    this.proxyOptions.disabledCommands ??= false
    this.proxyOptions.linkOnConnect ??= true
    this.proxyOptions.autoStartBotOnServerLogin ??= true
    this.proxyOptions.disconnectAllOnEnd ??= true

    this.proxyOptions.startOnLogin ??= true
    this.proxyOptions.stopOnLogoff ??= false

    this.proxyOptions.logPlayerJoinLeave ??= false
    
    if (this.proxyOptions.botAutoStart || !this.proxyOptions.startOnLogin) {
      this.startBot()
    }
    if (this.proxyOptions.serverAutoStart) {
      this.startServer()
    }
  }

  playerInWhitelist(name: string): boolean {
    if (!this.proxyOptions.security?.allowList) return true
    if (typeof this.proxyOptions.security.allowList === 'object') {
      return this.proxyOptions.security?.allowList?.find(n => n.toLowerCase() === name.toLowerCase()) !== undefined
    } else if (typeof this.proxyOptions.security.allowList === 'function') {
      try {
        return !!this.proxyOptions.security.allowList(name)
      } catch (e) {
        console.warn('allowlist callback had error', e)
        return false
      }
    }
    return false
  }

  botIsInControl() {
    if (!this.conn) return false
    return !this.conn.pclient
  }

  /**
   * @deprecated Use `startBot()` instead
   */
  async start() {
    return this.startBot()
  }

  async startBot() {
    if (this.conn) {
      console.info('Already started not starting')
      return
    }
    console.info('Starting bot')
    let offset: Vec3 | undefined = undefined
    if (this.proxyOptions.positionOffset) {
      offset = this.proxyOptions.positionOffset
    }
    const conn = new Conn(this.options, {
      toClientMiddleware: [...this.genToClientMiddleware(), ...(this.proxyOptions.toClientMiddlewares || [])],
      toServerMiddleware: [...this.genToServerMiddleware(), ...(this.proxyOptions.toServerMiddlewares || [])],
      positionTransformer: offset
    })
    this.conn = conn
    this.registerBotEvents()
    setTimeout().then(() => {
      this.emit('botReady', this.conn)
    })
    try {
      await onceWithCleanup(this.conn.stateData.bot, 'login')
      await setTimeout(1000)
      this.emit('botStart', this.conn)
    } catch (err) {
      console.info('Error login in with the bot', err)
    }
  }

  /**
   * @deprecated Use `stopBot()` or `stopServer()` instead
   */
  stop() {
    this.stopBot()
  }

  stopBot() {
    if (this.conn === undefined) {
      return
    }
    this.fakePlayer?.destroy()
    if (this.proxyOptions.disconnectAllOnEnd) {
        this.conn.pclients.forEach((c) => {
        c.end('Proxy disconnected')
      })
    }
    this.conn.disconnect()
    this.conn = undefined
    if (this.server) {
      if (this.proxyOptions.autoStartBotOnServerLogin) {
        this.server.motd = '§6Offline waiting for connections'
      } else {
        this.server.motd = '§6Offline'
      }
    }
  }

  /**
   * Stops the hosted server
   * @returns 
   */
  stopServer() {
    if (!this.server) return
    this.server.close()
    this.server = undefined
    this.emit('serverClose')
  }

  startServer() {
    if (this.server) {
      return
    }
    const motd = this.proxyOptions.motd ?? this.conn === undefined ? '§6Waiting for connections' : 'Logged in with §3' + this.conn.bot.username
    this.server = createServer({
      motd: motd,
      'online-mode': this.proxyOptions.security?.onlineMode ?? false,
      port: this.proxyOptions.port ?? 25566,
      version: '1.12.2',
      hideErrors: true
    })

    this.server.on('listening', () => {
      this.emit('serverStart')
      if (!this.proxyOptions.motd && this.conn?.bot && this.server) {
        this.server.motd = 'Logged in with §3' + this.conn.bot.username
      }
    })

    // @ts-ignore
    this.server.on('login', this.onClientLogin.bind(this))
  }

  broadcastMessage(message: string, prefix?: boolean, allowFormatting?: boolean, position?: number) {
    if (!this.server?.clients) return
    Object.values(this.server.clients).forEach(c => {
      this.message(c, message, prefix, allowFormatting, position)
    })
  }

  attach(client: ServerClient | Client, options: {
    toClientMiddleware?: PacketMiddleware[],
    toServerMiddleware?: PacketMiddleware[]
  } = {}) {
    if (!this.conn) return
    // const toClientMiddleware = this.genToClientMiddleware()
    // const toServerMiddleware = this.genToServerMiddleware()

    this.conn.attach(client as unknown as Client, options)
  }

  link(client: ServerClient | Client) {
    if (!this.conn) return
    if (client === this.conn.pclient) {
      this.message(client, 'Already in control cannot link!')
      return
    }
    
    if (!this.conn.pclient) {
      this.message(client, 'Linking')
      this.conn.link(client as unknown as Client)
      this.conn.bot.proxy.botIsControlling = !this.conn.pclient

      this.fakeSpectator?.revertPov(client)
      this.fakePlayer?.unregister(client as unknown as ServerClient)
      this.fakeSpectator?.revertToNormal(client as unknown as ServerClient)

      setTimeout().then(() => {
        if (!this.conn) return
        this.conn.bot.proxy.emitter.emit('proxyBotLostControl')
      })
    } else {
      const mes = `Cannot link. User §3${this.conn.pclient.username}§r is linked.`
      this.message(client, mes)
    }
  }

  unlink(client: Client | ServerClient | null) {
    if (!this.conn) return
    if (client) {
      if (client !== this.conn.pclient) {
        this.message(client, 'Cannot unlink as not in control!')
        return
      }
      this.fakePlayer?.register(client as unknown as ServerClient)
      this.fakeSpectator?.makeSpectator(client as unknown as ServerClient)
      this.message(client, 'Unlinking')
    }
    this.conn?.unlink()
    this.conn.bot.proxy.botIsControlling = true
    setTimeout().then(() => {
      if (!this.conn) return
      this.conn.bot.proxy.emitter.emit('proxyBotTookControl')
    })
  }

  async sendPackets(client: Client) {
    // this.conn?.sendPackets(client as unknown as Client)
    while (!this.conn?.stateData.bot?.player) {
      await sleep(100)
    }
    this.conn.sendPackets(client)
  }

  makeViewFakePlayer(client: ServerClient | Client) {
    if (!this.conn) return false
    if (client === this.conn.pclient) {
      this.message(client, `Cannot get into the view. You are controlling the bot`)
      return false
    }
    return this.fakeSpectator?.makeViewingBotPov(client)
  }

  makeViewNormal(client: ServerClient | Client) {
    if (!this.conn) return false
    if (client === this.conn.pclient) {
      this.message(client, 'Cannot get out off the view. You are controlling the bot')
      return false
    }
    return this.fakeSpectator?.revertPov(client) ?? false
  }

  private registerBotEvents() {
    if (!this.conn) return
    this.conn.bot.proxy = {
      botIsControlling: true,
      emitter: new EventEmitter(),
      botHasControl: () => !this.conn || (this.conn && this.conn.pclient === undefined),
      message: (client, message, prefix, allowFormatting, position) => {
        if (!this.conn) return
        this.message(client, message, prefix, allowFormatting, position)
      },
      broadcastMessage: (message, prefix, allowFormatting, position) => {
        if (!this.conn) return
        this.broadcastMessage(message, prefix, allowFormatting, position)
      }
    }

    this.conn.bot.once('login', () => {
      if (!this.conn) return
      this.fakePlayer = new FakePlayer(this.conn.stateData.bot, {
        username: this.conn.bot.username,
        uuid: this.conn.bot._client.uuid
      })
      this.fakeSpectator = new FakeSpectator(this.conn.bot)
      if (this.proxyOptions.serverAutoStart) {
        if (!this.server) this.startServer()
      }
      this.conn.bot.once('end', () => {
        this.fakePlayer?.destroy()
      })
      if (!this.proxyOptions.motd && this.server) {
        this.server.motd = 'Logged in with §3' + this.conn.bot.username
      }
    })

    this.conn.bot.once('end', () => {
      this.emit('botEnd', this.conn)
      if (this.proxyOptions.serverStopOnBotStop || this.proxyOptions.stopOnLogoff) {
        this.stopServer()
      }
    })
  }

  private async onClientLogin(client: ServerClient) {
    if (!this.playerInWhitelist(client.username)) {
      const { address, family, port } = {
        address: 'unknown',
        family: 'unknown',
        port: 'unknown',
        ...client.socket.address()
      }
      console.warn(`${client.username} is not in the whitelist, kicking (${address}, ${family}, ${port})`)
      client.end(this.proxyOptions.security?.kickMessage ?? 'You are not in the whitelist')
      return
    }
    if (!this.conn) { // If the bot is not currently running we might start it to connect the client
      if (this.proxyOptions.autoStartBotOnServerLogin) {
        await this.startBot()
      } else {
        client.end('Bot not started')
        return
      }
    }
    if (!this.conn) { // Airbag and to make typescript happy
      console.warn('Starting bot failed. Conn not available after startBot was called. Cannot login connecting client')
      return
    }
    if (this.proxyOptions.logPlayerJoinLeave) {
      console.info(`Player ${client.username} joined the proxy`)
    }
    
    const managedPlayer = this.worldManager.newManagedPlayer(client, this.conn.bot.entity.position)
    managedPlayer.loadedChunks = this.conn.bot.world.getColumns().map(({ chunkX, chunkZ }:  {chunkX: number, chunkZ: number}) => new Vec3(chunkX * 16, 0, chunkZ * 16))
    this.conn.bot.on('spawn', () => {
      if (!this.conn?.bot) return
      managedPlayer.pos = this.conn.bot.entity.position
    })
    this.conn.stateData.bot.physicsEnabled = false
    this.attach(client, {
      toClientMiddleware: [...managedPlayer.getMiddlewareToClient()]
    })
    await this.sendPackets(client as unknown as Client)
    
    const connect = this.proxyOptions.linkOnConnect && !this.conn.pclient
    this.broadcastMessage(`User §3${client.username}§r logged in. ${connect ? 'He is in control' : 'He is not in control'}`)
    this.printHelp(client)

    if (!connect) {
      // @ts-ignore
      this.fakePlayer?.register(client)
      // @ts-ignore
      this.fakeSpectator?.makeSpectator(client)
    } else {
      this.link(client)
    }

    client.once('end', () => {
      // @ts-ignore
      this.fakePlayer?.unregister(client)
      this.unlink(client)
      this.emit('clientDisconnect', client)
      this.broadcastMessage(`${this.proxyChatPrefix} User §3${client.username}§r disconnected`)
      if (this.proxyOptions.logPlayerJoinLeave) {
        console.info(`Player ${client.username} disconnected from the proxy`)
      }
      if (this.proxyOptions.botStopOnLogoff || this.proxyOptions.stopOnLogoff) {
        if (this.server && Object.values(this.server?.clients).length === 0) {
          this.stopBot()
        }
      }
    })

    this.emit('clientConnect', client)
  }

  message(client: Client | ServerClient, message: string, prefix: boolean = true, allowFormatting: boolean = true, position: number = 1) {
    if (!allowFormatting) {
      const r = /§./
      while (r.test(message)) {
        message = message.replace(r, '')
      }
    }
    if (prefix) {
      message = `${this.proxyChatPrefix} ${message}`
    }
    sendMessage(client, message, position)
  }

  printHelp(client: Client | ServerClient) {
    this.message(client, 'Available commands:')
    this.message(client, '$c [Message]    Send a message to all other connected clients')
    this.message(client, '$link    Links to the proxy if no one else is linked')
    this.message(client, '$unlink    Unlink and put into spectator mode')
    this.message(client, '$view    Connect into the view off the person currently connected')
    this.message(client, '$unview    Disconnect from the view')
    this.message(client, '$tp    Tp the spectator to the current proxy')
    this.message(client, '$help    This')
  }

  private genToServerMiddleware() {
    const inspector_toServerMiddleware: PacketMiddleware = ({ meta, pclient, data, isCanceled }) => {
      if (!this.conn || !pclient) return
      let returnValue: false | undefined = undefined
      if (meta.name === 'chat' && !this.proxyOptions.disabledCommands) {
        this.emit('clientChatRaw', pclient, data.message)
        let isCommand = false
        if ((data.message as string).startsWith('$')) { // command
          returnValue = false // Cancel everything that starts with $
          const cmd = (data.message as string).trim().substring(1) // remove $
          if (cmd === 'link') { // link command, replace the bot on the server
            this.link(pclient as unknown as ServerClient)
            return
          } else if (cmd === 'unlink') { // unlink command, give control back to the bot
            this.unlink(pclient)
          } else if (cmd === 'view') {
            const res = this.makeViewFakePlayer(pclient)
            if (res) {
              this.message(pclient, 'Connecting to view. Type $unview to exit')
            }
          } else if (cmd === 'unview') {
            const res = this.makeViewNormal(pclient)
            if (res) {
              this.message(pclient, 'Disconnecting from view. Type $view to connect')
            }
          } else if (cmd.startsWith('c')) {
            this.broadcastMessage(`[${pclient.username}] ${cmd.substring(2)}`)
          } else if (cmd === 'tp') {
            if (pclient === this.conn?.pclient) {
              this.message(pclient, `Cannot tp. You are controlling the bot.`)
              return
            }
            this.fakeSpectator?.revertPov(pclient)
            this.fakeSpectator?.tpToOrigin(pclient)
          } else if (cmd.startsWith('viewdistance')) {
            const words = cmd.split(' ')
            if (words[1] === 'disable') {
              this.message(pclient, 'Disabling extended render distance')
              this.worldManager.disableClientExtension(pclient)
              return
            }
            let chunkViewDistance = Number(words[1])
            if (isNaN(chunkViewDistance)) {
              chunkViewDistance = 20
            }
            this.message(pclient, `Setting player view distance to ${chunkViewDistance}`, true, true)
            this.worldManager.setClientView(pclient, chunkViewDistance)
            // this.worldManager.test(this.conn.bot.entity.position, this.worldManager.worlds['minecraft_overworld'], viewDistance)
          } else if (cmd === 'reloadchunks') {
            this.message(pclient, 'Reloading chunks', true, true)
            this.worldManager.reloadClientChunks(pclient, 2)
          } else {
            this.printHelp(pclient)
          }
          return false
        } else { // Normal chat messages
          data.message = data.message.substring(0, 250)
          this.emit('clientChat', pclient, data.message)
          returnValue = undefined
        }
        return data
      } else if (meta.name === 'use_entity') {
        return
      } else if (meta.name === 'use_entity') {
        if (this.fakeSpectator?.clientsInCamera[pclient.uuid] && this.fakeSpectator?.clientsInCamera[pclient.uuid].status) {
          if (data.mouse === 0 || data.mouse === 1) {
            this.fakeSpectator.revertPov(pclient)
            return false
          }
        }
      }
      return returnValue
    }

    return [inspector_toServerMiddleware]
  }

  private genToClientMiddleware() {
    const inspector_toClientMiddleware: PacketMiddleware = ({ meta, isCanceled, bound }) => {
      if (!this.conn) return
      if (isCanceled) return
      if (bound !== 'client') return
      if (this.botIsInControl()) {
        if (this.blockedPacketsWhenNotInControl.includes(meta.name)) return false
      }
    }

    const inspector_toClientFakePlayerSync: PacketMiddleware = ({ isCanceled, pclient, data, meta }) => {
      if (isCanceled) return
      if (pclient === this.conn?.pclient) return
      if (this.conn === undefined) return
      const botId = this.conn.bot.entity.id
      if (meta.name === 'collect' && data.collectorEntityId === botId) {
        data.collectorEntityId = FakePlayer.fakePlayerId
        return data
      } else if (meta.name === 'entity_metadata' && data.entityId === botId) {
        data.entityId = FakePlayer.fakePlayerId
        return data
      } else if (meta.name === 'entity_update_attributes' && data.entityId === botId) {
        data.entityId = FakePlayer.fakePlayerId
        return data
      }
      return data
    }
  
    const inspector_toClientMiddlewareRecipesFix: PacketMiddleware = ({ meta, bound, isCanceled }) => {
      if (isCanceled) return
      if (bound !== 'client') return
      if (meta.name === 'unlock_recipes') {
        return false
      }
    }

    return [inspector_toClientMiddleware, inspector_toClientFakePlayerSync, inspector_toClientMiddlewareRecipesFix]
  }

  setMotd(line1: string, line2: string = "") {
    if (!this.server) return
    line1 = String(line1).replace(/\n/g, '').slice(0, 200) // remove newlines
    line2 = String(line2).replace(/\n/g, '').slice(0, 200)
    const msg = `${line1}\n${line2}`
    this.server.motd = msg
    this.proxyOptions.motd = msg
  }

  setChatMessageMotd(message: ChatMessage) {
    if (!this.server) return
    this.server.motdMsg = message
  }
}

/**
 * 
 * @deprecated Use Proxy class instead
 * @param options Proxy options
 * @param proxyOptions 
 * @returns 
 */
export function makeBot(options: BotOptions, proxyOptions?: ProxyOptions): Conn {
  const cls = new InspectorProxy(options, proxyOptions)
  cls.startBot()
  if (!cls.conn) throw new Error('Something when wrong')
  return cls.conn
}
