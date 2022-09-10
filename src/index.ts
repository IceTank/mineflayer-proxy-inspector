import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, ServerClient } from "minecraft-protocol";
import type { Server } from "minecraft-protocol";
import { FakeSpectator, FakePlayer, sendMessage } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter, { once } from "events";
import { setTimeout } from "timers/promises";
import type { ChatMessage } from 'prismarine-chat'

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
  /** @deprecated use botStartOnLogin instead */
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

  logPlayerJoinLeave?: boolean
  /** Disconnect all connected players once the proxy bot stops. Defaults to true. If not on players will still be connected but won't receive updates from the server. */
  disconnectAllOnEnd?: boolean

  toClientMiddlewares?: PacketMiddleware[]
  toServerMiddlewares?: PacketMiddleware[]
  disabledCommands?: boolean
}

declare module 'mineflayer' {
  interface Bot {
    proxy: {
      botIsControlling: boolean
      emitter: ProxyInspectorEmitter
      message(client: Client | ServerClient, message: string, prefix?: boolean, allowFormatting?: boolean): void
      broadcastMessage(message: string, prefix?: boolean, allowFormatting?: boolean): void
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
  on(event: 'serverStart', listener: () => void): this
}

export class InspectorProxy extends EventEmitter {
  options: BotOptions
  proxyOptions: ProxyOptions
  conn?: Conn
  server: Server | undefined
  fakePlayer?: FakePlayer
  fakeSpectator?: FakeSpectator
  blockedPacketsWhenNotInControl: string[]
  proxyChatPrefix: string = '§6Proxy >>§r'

  constructor(options: BotOptions, proxyOptions: ProxyOptions = {}) {
    super()
    this.options = options
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

    this.proxyOptions.logPlayerJoinLeave ??= true
    
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
    return !this.conn.writingClient
  }

  /**
   * @deprecated Use `startBot()` instead
   */
  async start() {
    return this.startBot()
  }

  async startBot() {
    if (this.conn) {
      console.warn('Already running not starting')
      return
    }
    console.info('Starting bot')
    this.conn = new Conn(this.options, {
      toClientMiddleware: [...this.genToClientMiddleware(), ...(this.proxyOptions.toClientMiddlewares || [])],
      toServerMiddleware: [...this.genToServerMiddleware(), ...(this.proxyOptions.toServerMiddlewares || [])]
    })
    this.registerBotEvents()
    setTimeout().then(() => {
      this.emit('botReady', this.conn)
    })
    await once(this.conn.bot, 'login')
    await setTimeout(1000)
    this.emit('botStart', this.conn)
  }

  /**
   * @deprecated Use `stopBot()` or `stopServer()` instead
   */
  stop() {
    this.stopBot()
  }

  stopBot() {
    if (this.conn === undefined) {
      console.warn('Already stopped')
      return
    }
    console.info('Stopping Bot')
    this.fakePlayer?.destroy()
    if (this.proxyOptions.disconnectAllOnEnd) {
        this.conn.receivingClients.forEach((c) => {
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
    console.info('Stopping server')
    this.server.close()
    this.server = undefined
  }

  startServer() {
    if (this.server) {
      console.warn('Already running not starting')
      return
    }
    console.info('Starting server')
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

    this.server.on('login', this.onClientLogin.bind(this))
  }

  broadcastMessage(message: string, prefix?: boolean, allowFormatting?: boolean) {
    if (!this.server?.clients) return
    Object.values(this.server.clients).forEach(c => {
      this.message(c, message, prefix, allowFormatting)
    })
  }

  attach(client: ServerClient) {
    if (!this.conn) return
    // const toClientMiddleware = this.genToClientMiddleware()
    // const toServerMiddleware = this.genToServerMiddleware()

    this.conn.attach(client as unknown as Client)
  }

  link(client: ServerClient | Client) {
    if (!this.conn) return
    if (client === this.conn.writingClient) {
      console.warn('Already in control cannot link!')
      this.message(client, 'Already in control cannot link!')
      return
    }
    
    if (!this.conn.writingClient) {
      // console.info('Linking', this.proxyOptions.linkOnConnect)
      this.message(client, 'Linking')
      this.conn.link(client as unknown as Client)
      this.conn.bot.proxy.botIsControlling = !this.conn.writingClient

      this.fakeSpectator?.revertPov(client)
      this.fakePlayer?.unregister(client as unknown as ServerClient)
      this.fakeSpectator?.revertToNormal(client as unknown as ServerClient)

      setTimeout().then(() => {
        if (!this.conn) return
        this.conn.bot.proxy.emitter.emit('proxyBotLostControl')
      })
    } else {
      const mes = `Cannot link. User §3${this.conn.writingClient.username}§r is linked.`
      console.warn(mes)
      this.message(client, mes)
    }
  }

  unlink(client: Client | ServerClient) {
    if (!this.conn) return
    if (client !== this.conn.writingClient) {
      console.warn('Cannot unlink as not in control!')
      this.message(client, 'Cannot unlink as not in control!')
      return
    }
    this.conn?.unlink()
    this.conn.bot.proxy.botIsControlling = true
    this.fakePlayer?.register(client as unknown as ServerClient)
    this.fakeSpectator?.makeSpectator(client as unknown as ServerClient)
    this.message(client, 'Unlinking')
    setTimeout().then(() => {
      if (!this.conn) return
      this.conn.bot.proxy.emitter.emit('proxyBotTookControl')
    })
  }

  sendPackets(client: ServerClient) {
    this.conn?.sendPackets(client as unknown as Client)
  }

  makeViewFakePlayer(client: ServerClient | Client) {
    if (!this.conn) return false
    if (client === this.conn.writingClient) {
      this.message(client, `Cannot get into the view. You are controlling the bot`)
      return false
    }
    return this.fakeSpectator?.makeViewingBotPov(client)
  }

  makeViewNormal(client: ServerClient | Client) {
    if (!this.conn) return false
    if (client === this.conn.writingClient) {
      this.message(client, 'Cannot get out off the view. You are controlling the bot')
      return false
    }
    return this.fakeSpectator?.revertPov(client)
  }

  private registerBotEvents() {
    if (!this.conn) return
    this.conn.bot.proxy = {
      botIsControlling: true,
      emitter: new EventEmitter(),
      botHasControl: () => !this.conn || (this.conn && this.conn.writingClient === undefined),
      message: (client, message, prefix, allowFormatting) => {
        if (!this.conn) return
        this.message(client, message, prefix, allowFormatting)
      },
      broadcastMessage: (message, prefix, allowFormatting) => {
        if (!this.conn) return
        this.broadcastMessage(message, prefix, allowFormatting)
      }
    }

    this.conn.bot.once('login', () => {
      if (!this.conn) return
      this.fakePlayer = new FakePlayer(this.conn.bot, {
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
      console.info(`Bot stopped`)
      if (this.proxyOptions.serverStopOnBotStop || this.proxyOptions.stopOnLogoff) {
        this.stopServer()
      }
    })
  }

  async onClientLogin(client: ServerClient) {
    if (!this.conn) return
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
    if (this.proxyOptions.autoStartBotOnServerLogin) {
      await this.startBot()
    } else {
      client.end('Bot not started')
      console.info(`User ${client.username} tried to login but bot is not started`, new Date())
      return
    }
    console.info(`User ${client.username} logged in`, new Date())
    
    this.sendPackets(client)
    this.attach(client)
    
    const connect = this.proxyOptions.linkOnConnect && !this.conn.writingClient
    this.broadcastMessage(`User §3${client.username}§r logged in. ${connect ? 'He is in control' : 'He is not in control'}`)
    this.printHelp(client)

    if (!connect) {
      console.info('Connection not linking for client', client.username)
      this.fakePlayer?.register(client)
      // this.fakePlayer?.spawn(client)
      this.fakeSpectator?.makeSpectator(client)
    } else {
      console.info('Connection linking for client', client.username)
      this.link(client)
    }

    client.once('end', () => {
      this.fakePlayer?.unregister(client)
      this.unlink(client)
      this.emit('clientDisconnect', client)
      this.broadcastMessage(`${this.proxyChatPrefix} User §3${client.username}§r disconnected`)
      console.info(`User ${client.username} logged off`, new Date())
      if (this.proxyOptions.botStopOnLogoff || this.proxyOptions.stopOnLogoff) {
        if (this.server && Object.values(this.server?.clients).length === 0) {
          console.info('Last player disconnected stopping server')
          this.stopBot()
        }
      }
    })

    this.emit('clientConnect', client)
  }

  message(client: Client | ServerClient, message: string, prefix: boolean = true, allowFormatting: boolean = true) {
    if (!allowFormatting) {
      const r = /§./
      while (r.test(message)) {
        message = message.replace(r, '')
      }
    }
    if (prefix) {
      message = `${this.proxyChatPrefix} ${message}`
    }
    sendMessage(client, message)
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

  genToServerMiddleware() {
    const inspector_toServerMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (!this.conn) return
      if (info.meta.name === 'chat' && !this.proxyOptions.disabledCommands) {
        // console.info('Client chat')
        this.emit('clientChatRaw', pclient, data.message)
        if ((data.message as string).startsWith('$')) { // command
          canceler() // Cancel everything that starts with $
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
            if (pclient === this.conn?.writingClient) {
              this.message(pclient, `Cannot tp. You are controlling the bot.`)
              return
            }
            this.fakeSpectator?.revertPov(pclient)
            this.fakeSpectator?.tpToOrigin(pclient)
          } else {
            this.printHelp(pclient)
          }
        } else { // Normal chat messages
          console.info(`User ${pclient.username} chat: ${data.message}`)
          data.message = data.message.substring(0, 250)
          this.emit('clientChat', pclient, data.message)
          update()
          canceler(true)
        }
        return
      } else if (info.meta.name === 'use_entity') {
        if (this.fakeSpectator?.clientsInCamera[pclient.uuid] && this.fakeSpectator?.clientsInCamera[pclient.uuid].status) {
          if (data.mouse === 0 || data.mouse === 1) {
            this.fakeSpectator.revertPov(pclient)
          }
        }
      }
    }

    return [inspector_toServerMiddleware]
  }

  genToClientMiddleware() {
    const inspector_toClientMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (!this.conn) return
      if (canceler.isCanceled) return
      if (info.bound !== 'client') return
      if (this.botIsInControl()) {
        if (this.blockedPacketsWhenNotInControl.includes(info.meta.name)) return canceler()
      }
    }

    const inspector_toClientFakePlayerSync: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (canceler.isCanceled) return
      if (pclient === this.conn?.writingClient) return
      if (this.conn === undefined) return
      const botId = this.conn.bot.entity.id
      if (info.meta.name === 'collect' && data.collectorEntityId === botId) {
        data.collectorEntityId = FakePlayer.fakePlayerId
        update()
      } else if (info.meta.name === 'entity_metadata' && data.entityId === botId) {
        data.entityId = FakePlayer.fakePlayerId
        update()
      } else if (info.meta.name === 'entity_update_attributes' && data.entityId === botId) {
        data.entityId = FakePlayer.fakePlayerId
        update()
      }
    }
  
    const inspector_toClientMiddlewareRecipesFix: PacketMiddleware = (info, pclient, data, canceler) => {
      if (canceler.isCanceled) return
      if (info.bound !== 'client') return
      if (info.meta.name === 'unlock_recipes') {
        canceler()
        return
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
