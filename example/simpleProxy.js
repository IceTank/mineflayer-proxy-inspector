const { InspectorProxy } = require('../')
const { Vec3 } = require('vec3')

const proxy = new InspectorProxy({
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
  // positionOffset: new Vec3(5000, 0, 0),
  worldCaching: false
})

proxy.on('clientDisconnect', () => {
  console.info('Client disconnected')
})

proxy.on('serverStart', () => console.info('Server started'))
proxy.on('serverClose', () => console.info('Server closed'))
proxy.on('botEnd', () => console.info('Bot disconnected'))

proxy.on('botStart', (conn) => {
  console.info('Bot spawned')

  proxy.on('clientChat', (client, line) => {
    if (line === 'test') {
      console.info(proxy.conn.receivingClients)
    }
  })
})
