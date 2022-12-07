const { InspectorProxy } = require('../')

// const readline = require('readline')
// const rl = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout
// })

// rl.on('line', (line) => {
//   line = line.trim().toLowerCase()
//   if (line === 'stopserver') {
//     proxy.stopServer()
//   } else if (line === 'startserver') {
//     proxy.startServer()
//   } else if (line === 'stopbot') {
//     proxy.stopBot()
//   } else if (line === 'startbot') {
//     proxy.startBot()
//   }
// })

let highestId = -Infinity

/** @type { import('@rob9315/mcproxy').PacketMiddleware } */
const mapShowMiddleware = ({ meta, pclient, data }) => {
  if (meta.name !== 'map') return
  const mapId = data.itemDamage
  if (mapId !== 0 && mapId > highestId) highestId = mapId
}

const proxy = new InspectorProxy({
  // host: 'localhost',
  // username: 'mcIc3Tank@outlook.com',
  host: 'localhost',
  username: 'proxyBot',
  auth: 'offline',
  profilesFolder: './nmp-cache',
  version: '1.12.2',
  checkTimeoutInterval: 90_000,
  // port: 25567
}, {
  // linkOnConnect: true,
  botAutoStart: false, // start the bot when the proxy starts
  botStopOnLogoff: true, // Stop the bot when the last person leaves the proxy
  serverAutoStart: true, // start the server when the proxy starts
  serverStopOnBotStop: false, // Stop the server when the bot stops
  autoStartBotOnServerLogin: true,
  toClientMiddlewares: [mapShowMiddleware]
})

proxy.on('clientConnect', (client) => {
  console.info(`Client ${client.username} connected`)
  setInterval(() => {
    proxy.message(client, `Current id ${highestId}`, undefined, undefined, 2)
  }, 2000)
})

proxy.on('clientDisconnect', () => {
  console.info('Client disconnected')
})

proxy.on('serverStart', () => console.info('Server started'))
proxy.on('serverClose', () => console.info('Server closed'))

proxy.on('botStart', (conn) => {
  console.info('Bot spawned')

  proxy.on('clientChat', (client, line) => {
    if (line === 'test') {
      console.info(proxy.conn.receivingClients)
    }
  })
  
  conn.bot._client.on('packet', (data, packetMeta) => {
    if (packetMeta.name === 'unlock_recipes') { // This packet is blocked because it is causing issues on 2beeetwoteee
      console.info(data)
    }
  })
})
