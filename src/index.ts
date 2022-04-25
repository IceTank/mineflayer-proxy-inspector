import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, PacketMeta } from "minecraft-protocol";
import { FakeSpectator, FakePlayer } from "./util";
import { BotOptions } from "mineflayer";
import EventEmitter from "events";

export interface ProxyOptions {
  port?: number
  motd?: string
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

export function makeBot(options: BotOptions, proxyOptions?: ProxyOptions) {
  const conn = new Conn(options)
  proxyOptions = proxyOptions ?? {}

  const blockedPackets = ['abilities', 'position']
  let gotPosition = false
  let fakePlayer: FakePlayer
  let fakeSpectator: FakeSpectator

  conn.bot.proxy = {
    botIsControlling: true,
    emitter: new EventEmitter()
  }

  conn.bot.once('spawn', () => {
    const server = createServer({
      motd: proxyOptions?.motd ?? 'mc proxy bot inspector',
      'online-mode': false,
      port: proxyOptions?.port ?? 25566,
      version: '1.12.2'
    })

    conn.bot.once('end', () => {
      server.close()
    })
  
    server.on('login', (client) => {
      fakePlayer = new FakePlayer(conn.bot, client)
      fakeSpectator = new FakeSpectator(client)
      conn.sendPackets(client as unknown as Client)
  
      fakePlayer.spawn()
      fakeSpectator.makeSpectator()
      
      conn.attach(client as unknown as Client, {
        toClientMiddleware: [inspector_toClientMiddleware, inspector_toClientMiddlewareRecipesFix],
        toServerMiddleware: [inspector_toServerMiddleware]
      })

      client.on('end', () => {
        fakePlayer.destroy()
      })
    })
  })

  const inspector_toServerMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
    if (info.meta.name !== 'chat') return
    if (info.meta.name === 'chat') {
      console.info('Client chat')
      if ((data.message as string).startsWith('$')) { // command
        const cmd = (data.message as string).trim().substring(1) // remove $
        if (cmd === 'link') { // link command, replace the bot on the server
          conn.link(pclient)
          conn.bot.proxy.botIsControlling = false
          fakePlayer.deSpawn()
          fakeSpectator.revertToNormal(conn.bot)
          canceler()
          setTimeout(() => {
            conn.bot.proxy.emitter.emit('proxyBotLostControl')
          })
          return
        } else if (cmd === 'unlink') { // unlink command, give control back to the bot
          conn.unlink()
          conn.bot.proxy.botIsControlling = true
          fakePlayer.spawn()
          fakeSpectator.makeSpectator()
          canceler()
          setTimeout(() => {
            conn.bot.proxy.emitter.emit('proxyBotTookControl')
          })
          return
        }
      } else { // Normal chat messages
        console.info('None command parse through:' + data.message) 
        update()
        canceler(true)
      }
      return
    }
  }

  const inspector_toClientMiddleware: PacketMiddleware = (info, pclient, data, canceler, update) => {
    if (canceler.isCanceled) return
    if (info.bound !== 'client') return
    if (blockedPackets.includes(info.meta.name)) return canceler()
    if (info.meta.name === 'position' && data) {
      if (!gotPosition) {
        gotPosition = true
        return
      }
      canceler()
      return
    } else if (info.meta.name === 'collect') {
      if (data.collectorEntityId === conn.bot.entity.id) {
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

  return conn
}
