import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, PacketMeta } from "minecraft-protocol";
import type { Server } from "minecraft-protocol";
import { FakeSpectator, FakePlayer } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter from "events";

export interface ProxyOptions {
  port?: number
  motd?: string
  security?: {
    onlineMode?: boolean
    allowList?: string[]
    kickMessage?: string
  }
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

  constructor(options: BotOptions, proxyOptions: ProxyOptions = {}) {
    super()
    this.options = options
    this.proxyOptions = proxyOptions
    this.conn = new Conn(options)
    this.server = undefined
    this.init()
  }

  playerInWhitelist(name: string) {
    if (!this.proxyOptions.security?.allowList) return true
    return this.proxyOptions.security?.allowList?.find(n => n.toLowerCase() === name.toLowerCase()) !== undefined
  }

  botIsInControl() {
    return !this.conn.writingClient
  }

  private init() {
    const blockedPacketsWhenNotInControl = ['abilities', 'position']
    let fakePlayer: FakePlayer
    let fakeSpectator: FakeSpectator

    this.conn.bot.proxy = {
      botIsControlling: true,
      emitter: new EventEmitter()
    }

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
      })
    
      this.server.on('login', (client) => {
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
        fakePlayer = new FakePlayer(this.conn.bot, client)
        fakeSpectator = new FakeSpectator(client)
        this.conn.sendPackets(client as unknown as Client)
    
        fakePlayer.spawn()
        fakeSpectator.makeSpectator()
        
        this.conn.attach(client as unknown as Client, {
          toClientMiddleware: [inspector_toClientMiddleware, inspector_toClientMiddlewareRecipesFix],
          toServerMiddleware: [inspector_toServerMiddleware]
        })

        client.on('end', () => {
          fakePlayer.destroy()
          this.emit('clientDisconnect', client)
        })

        this.emit('clientConnect', client)
      })
    })

    const inspector_toServerMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (info.meta.name === 'chat') {
        console.info('Client chat')
        this.emit('clientChatRaw', pclient, data.message)
        if ((data.message as string).startsWith('$')) { // command
          const cmd = (data.message as string).trim().substring(1) // remove $
          if (cmd === 'link') { // link command, replace the bot on the server
            this.conn.link(pclient)
            this.conn.bot.proxy.botIsControlling = false
            fakePlayer.deSpawn()
            fakeSpectator.revertToNormal(this.conn.bot)
            canceler()
            setTimeout(() => {
              this.conn.bot.proxy.emitter.emit('proxyBotLostControl')
            })
            return
          } else if (cmd === 'unlink') { // unlink command, give control back to the bot
            this.conn.unlink()
            this.conn.bot.proxy.botIsControlling = true
            fakePlayer.spawn()
            fakeSpectator.makeSpectator()
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

    const inspector_toClientMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
      if (canceler.isCanceled) return
      if (info.bound !== 'client') return
      if (this.botIsInControl()) {
        if (blockedPacketsWhenNotInControl.includes(info.meta.name)) return canceler()
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
