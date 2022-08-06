const { InspectorProxy } = require('../')

const readline = require('readline')
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('line', (line) => {
  line = line.trim().toLowerCase()
  if (line === 'stopserver') {
    proxy.stopServer()
  } else if (line === 'startserver') {
    proxy.startServer()
  } else if (line === 'stopbot') {
    proxy.stopBot()
  } else if (line === 'startbot') {
    proxy.startBot()
  }
})

const proxy = new InspectorProxy({
  host: 'localhost',
  username: 'proxyBot',
  version: '1.12.2'
}, {
  linkOnConnect: true,
  botAutoStart: false, // start the bot when the proxy starts
  botStopOnLogoff: false, // Stop the bot when the last person leaves the proxy
  serverAutoStart: true, // start the server when the proxy starts
  serverStopOnBotStop: false, // Stop the server when the bot stops
  autoStartBotOnServerLogin: false
})

proxy.on('botStart', (conn) => {
  conn.bot.on('spawn', () => {
    console.info('Bot spawned')
  })
  
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
