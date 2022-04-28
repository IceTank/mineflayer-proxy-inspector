import { Client, Conn, PacketMiddleware, packetAbilities, sendTo } from "@rob9315/mcproxy";
import { createServer, PacketMeta } from "minecraft-protocol";
const wait = require('util').promisify(setTimeout)
import { FakeSpectator, FakePlayer } from "./util";
import { BotOptions } from "mineflayer";

export interface ProxyOptions {
  port?: number
  motd?: string
}

export function makeBot(options: BotOptions, proxyOptions?: ProxyOptions) {
  const conn = new Conn(options)
  proxyOptions = proxyOptions ?? {}

  const blockedPackets = ['abilities', 'position']
  let gotPosition = false
  let fakePlayer: FakePlayer
  let fakeSpectator: FakeSpectator

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
        toClientMiddleware: inspector_toClientMiddleware,
        toServerMiddleware: inspector_toServerMiddleware
      })

      client.on('end', () => {
        fakePlayer.destroy()
      })
    })
  })

  function inspector_toServerMiddleware(info: { bound: 'server' | 'client'; writeType: 'packet' | 'rawPacket' | 'channel'; meta: PacketMeta; }, pclient: Client, data: any, cancel: (unCancel?: boolean) => void, isCanceled: boolean) {
    if (info.meta.name !== 'chat') return
    console.info('Client chat')
    if ((data.message as string).startsWith('$')) {
      const cmd = (data.message as string).trim().substring(1)
      if (cmd === 'link') {
        conn.link(pclient)
        fakePlayer.deSpawn()
        fakeSpectator.revertToNormal(conn.bot)
        // conn.sendPackets(pclient)
      } else if (cmd === 'unlink') {
        conn.unlink()
        fakePlayer.spawn()
        fakeSpectator.makeSpectator()
      } else if (cmd === 'view') {
        fakeSpectator.makeViewingBotPov(conn.bot)
      } else if (cmd === 'unview') {
        fakeSpectator.revertPov(conn.bot)
      }
      cancel()
      return
    } else {
      cancel(false)
    }
  }

  function inspector_toClientMiddleware(info: { bound: 'server' | 'client'; writeType: 'packet' | 'rawPacket' | 'channel'; meta: PacketMeta; }, pclient: Client, data: any, cancel: () => void, isCanceled: boolean) {
    if (isCanceled) return
    if (info.bound !== 'client') return
    if (blockedPackets.includes(info.meta.name)) return cancel()
    if (info.meta.name === 'position' && data) {
      if (!gotPosition) {
        gotPosition = true
        return
      }
      cancel()
      return
    } else if (info.meta.name === 'collect') {
      if (data.collectorEntityId === conn.bot.entity.id) {
        data.collectorEntityId = FakePlayer.fakePlayerId
      }
    }
  }

  return conn
}
