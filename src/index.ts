import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, ServerClient } from "minecraft-protocol";
import type { Server } from "minecraft-protocol";
import { FakeSpectator, FakePlayer, sendMessage } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter from "events";

export interface ProxyOptions {
  port?: number
  motd?: string
  security?: {
    onlineMode?: boolean
    allowList?: string[]
    kickMessage?: string
  },
  linkOnConnect?: boolean
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
}

export class InspectorProxy extends EventEmitter {
  options: BotOptions
  proxyOptions: ProxyOptions
  conn: Conn
  server: Server | undefined
  fakePlayer?: FakePlayer
  fakeSpectator?: FakeSpectator
  blockedPacketsWhenNotInControl: string[]

  constructor(options: BotOptions, proxyOptions: ProxyOptions = {}) {
    super()
    this.options = options
    this.proxyOptions = proxyOptions
    this.conn = new Conn(options)
    this.server = undefined
    this.blockedPacketsWhenNotInControl = ['abilities', 'position']
    this.init()
  }

  playerInWhitelist(name: string) {
    if (!this.proxyOptions.security?.allowList) return true
    return this.proxyOptions.security?.allowList?.find(n => n.toLowerCase() === name.toLowerCase()) !== undefined
  }

  botIsInControl() {
    return !this.conn.writingClient
  }

  broadcastMessage(message: string) {
    if (!this.server?.clients) return
    Object.values(this.server.clients).forEach(c => {
      sendMessage(c, message)
    })
  }

  attach(client: ServerClient) {
    const toClientMiddleware = this.genToClientMiddleware(client)
    const toServerMiddleware = this.genToServerMiddleware(client)

    this.conn.attach(client as unknown as Client, {
      toClientMiddleware: toClientMiddleware,
      toServerMiddleware: toServerMiddleware
    })
  }

  link(client: ServerClient) {
    if (!this.conn.writingClient) {
      console.info('Linking', this.proxyOptions.linkOnConnect)
      this.conn.link(client as unknown as Client)
    } else {
      const mes = `Cannot link. User ${this.conn.writingClient.username} is linked.`
      console.warn(mes)
      sendMessage(client, mes)
    }
  }

  unlink() {
    this.conn.unlink()
  }

  sendPackets(client: ServerClient) {
    this.conn.sendPackets(client as unknown as Client)
  }

  private init() {
    this.conn.bot.proxy = {
      botIsControlling: true,
      emitter: new EventEmitter()
    }

    this.conn.bot.once('login', () => {
      console.info('Inject allowed event')
      this.fakePlayer = new FakePlayer(this.conn.bot, {
        username: this.conn.bot.username,
        uuid: this.conn.bot._client.uuid
      })
      this.fakeSpectator = new FakeSpectator(this.conn.bot)
    })

    this.conn.bot.on('end', () => {
      this.fakePlayer?.destroy()
    })

    this.conn.bot.once('login', () => {
      this.server = createServer({
        motd: this.proxyOptions.motd ?? 'mc proxy bot inspector',
        'online-mode': this.proxyOptions.security?.onlineMode ?? false,
        port: this.proxyOptions.port ?? 25566,
        version: '1.12.2'
      })

      this.conn.bot.once('end', () => {
        if (!this.server) return
        this.server.close()
        this.fakePlayer?.destroy()
      })
    
      this.server.on('login', this.onClientLogin.bind(this))
    })
  }

  onClientLogin(client: ServerClient) {
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
    this.broadcastMessage(`Proxy >> User ${client.username} logged in. ${connect ? 'He is in control' : 'He is not in control'}`)

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
      this.broadcastMessage(`Proxy >> User ${client.username} disconnected`)
      console.info(`User ${client.username} logged off`, new Date())
    })

    this.emit('clientConnect', client)
  }

  genToServerMiddleware(client: ServerClient) {
    const inspector_toServerMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (info.meta.name === 'chat') {
        console.info('Client chat')
        this.emit('clientChatRaw', pclient, data.message)
        if ((data.message as string).startsWith('$')) { // command
          const cmd = (data.message as string).trim().substring(1) // remove $
          if (cmd === 'link') { // link command, replace the bot on the server
            if (pclient === this.conn.writingClient) {
              console.warn('Already in control cannot link!')
              sendMessage(pclient, 'Already in control cannot link!')
              return
            }
            if (this.conn.writingClient) {
              const mes = `Cannot link. User ${this.conn.writingClient.username} is currently linked.`
              console.info(mes)
              sendMessage(pclient, mes)
              return
            }
            this.link(pclient as unknown as ServerClient)
            this.conn.bot.proxy.botIsControlling = !this.conn.writingClient
            // this.fakePlayer?.deSpawn(client)
            this.fakePlayer?.unregister(client)
            this.fakeSpectator?.revertToNormal(client)
            canceler()
            setTimeout(() => {
              this.conn.bot.proxy.emitter.emit('proxyBotLostControl')
            })
            return
          } else if (cmd === 'unlink') { // unlink command, give control back to the bot
            if (pclient !== this.conn.writingClient) {
              console.warn('Cannot unlink as not in control!')
              sendMessage(pclient, 'Cannot unlink as not in control!')
              return
            }
            this.unlink()
            this.conn.bot.proxy.botIsControlling = true
            // this.fakePlayer?.spawn(client)
            this.fakePlayer?.register(client)
            this.fakeSpectator?.makeSpectator(client)
            canceler()
            setTimeout(() => {
              this.conn.bot.proxy.emitter.emit('proxyBotTookControl')
            })
            return
          }
        } else { // Normal chat messages
          console.info('None command parse through:' + data.message)
          this.emit('clientChat', pclient, data.message)
          update()
          canceler(true)
        }
        return
      }
    }

    return [inspector_toServerMiddleware]
  }

  genToClientMiddleware(client: ServerClient) {
    const inspector_toClientMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (canceler.isCanceled) return
      if (info.bound !== 'client') return
      if (this.botIsInControl()) {
        if (this.blockedPacketsWhenNotInControl.includes(info.meta.name)) return canceler()
      }
      if (info.meta.name === 'collect' && this.botIsInControl()) {
        if (data.collectorEntityId === this.conn.bot.entity.id) {
          data.collectorEntityId = FakePlayer.fakePlayerId
          update()
        }
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

    return [inspector_toClientMiddleware, inspector_toClientMiddlewareRecipesFix]
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
  return cls.conn
}
