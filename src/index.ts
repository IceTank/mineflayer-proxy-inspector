import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, ServerClient } from "minecraft-protocol";
import type { Server } from "minecraft-protocol";
import { FakeSpectator, FakePlayer, sendMessage } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter, { once } from "events";
import { setTimeout } from "timers/promises";

export { sendMessage }

export interface ProxyOptions {
  port?: number
  motd?: string
  security?: {
    onlineMode?: boolean
    allowList?: string[]
    kickMessage?: string
  },
  linkOnConnect?: boolean
  startOnLogin?: boolean
  stopOnLogoff?: boolean
  toClientMiddlewares?: PacketMiddleware[]
  toServerMiddlewares?: PacketMiddleware[]
  disabledCommands?: boolean
}

declare module 'mineflayer' {
  interface Bot {
    proxy: {
      botIsControlling: boolean
      emitter: ProxyInspectorEmitter
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
  commandsDisabled: boolean
  proxyChatPrefix: string = '§6Proxy >>§r'

  constructor(options: BotOptions, proxyOptions: ProxyOptions = {}) {
    super()
    this.options = options
    this.proxyOptions = proxyOptions
    this.server = undefined
    this.blockedPacketsWhenNotInControl = ['abilities', 'position']
    if (!this.proxyOptions.startOnLogin) {
      this.start()
    }
    this.commandsDisabled = this.proxyOptions.disabledCommands ?? false
    this.startServer()
  }

  playerInWhitelist(name: string) {
    if (!this.proxyOptions.security?.allowList) return true
    return this.proxyOptions.security?.allowList?.find(n => n.toLowerCase() === name.toLowerCase()) !== undefined
  }

  botIsInControl() {
    if (!this.conn) return false
    return !this.conn.writingClient
  }

  async start() {
    if (this.conn) {
      console.warn('Already running not starting')
      return
    }
    this.conn = new Conn(this.options, {
      toClientMiddleware: [...this.genToClientMiddleware(), ...(this.proxyOptions.toClientMiddlewares || [])],
      toServerMiddleware: [...this.genToServerMiddleware(), ...(this.proxyOptions.toServerMiddlewares || [])]
    })
    this.registerEvents()
    setTimeout().then(() => {
      this.emit('botReady', this.conn)
    })
    await once(this.conn.bot, 'login')
    await setTimeout(1000)
    this.emit('botStart', this.conn)
  }

  stop() {
    if (this.conn === undefined) {
      console.warn('Already stopped')
      return
    }
    console.info('Stopping')
    this.fakePlayer?.destroy()
    this.conn.disconnect()
    this.conn = undefined
    if (this.server) {
      this.server.motd = 'Offline waiting for connections'
    }
  }

  broadcastMessage(message: string) {
    if (!this.server?.clients) return
    Object.values(this.server.clients).forEach(c => {
      this.message(c, message)
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
      console.info('Linking', this.proxyOptions.linkOnConnect)
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

  private startServer() {
    const motd = this.proxyOptions.motd ?? this.conn === undefined ? '§6waiting for connections' : 'logged in with §3' + this.conn.bot.username
    this.server = createServer({
      motd: motd,
      'online-mode': this.proxyOptions.security?.onlineMode ?? false,
      port: this.proxyOptions.port ?? 25566,
      version: '1.12.2',
      hideErrors: true
    })

    this.server.on('listening', () => {
      this.emit('serverStart')
    })

    this.server.on('login', this.onClientLogin.bind(this))
  }

  private registerEvents() {
    if (!this.conn) return
    this.conn.bot.proxy = {
      botIsControlling: true,
      emitter: new EventEmitter()
    }

    this.conn.bot.once('login', () => {
      if (!this.conn) return
      this.fakePlayer = new FakePlayer(this.conn.bot, {
        username: this.conn.bot.username,
        uuid: this.conn.bot._client.uuid
      })
      this.fakeSpectator = new FakeSpectator(this.conn.bot)
    })

    this.conn.bot.on('end', () => {
      if (this.proxyOptions.stopOnLogoff) this.stop()
    })

    this.conn.bot.once('login', () => {
      if (!this.conn) return
      
      this.conn.bot.once('end', () => {
        if (!this.server) return
        // this.server.close()
        this.fakePlayer?.destroy()
      })
    })
  }

  async onClientLogin(client: ServerClient) {
    if (!this.conn)
    if (this.proxyOptions.startOnLogin) {
      await this.start()
    }
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
      this.emit('clientDisconnect', client)
      this.broadcastMessage(`${this.proxyChatPrefix} User §3${client.username}§r disconnected`)
      console.info(`User ${client.username} logged off`, new Date())
      if (this.proxyOptions.stopOnLogoff) {
        if (this.server && Object.values(this.server?.clients).length === 0) {
          console.info('Last player disconnected stopping server')
          this.stop()
        }
      }
    })

    this.emit('clientConnect', client)
  }

  message(client: Client | ServerClient, message: string, prefix: boolean = true, allowFormatting: boolean = true) {
    if (allowFormatting) {
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
      if (info.meta.name === 'chat' && !this.commandsDisabled) {
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
    this.server.motd = `${line1}\n${line2}`
  }

  setChatMessageMotd(message: Object) {
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
  cls.start()
  if (!cls.conn) throw new Error('Something when wrong')
  return cls.conn
}
