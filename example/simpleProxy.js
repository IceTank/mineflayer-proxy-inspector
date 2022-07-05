const { InspectorProxy } = require('../')

const proxy = new InspectorProxy({
  host: 'localhost',
  username: 'proxyBot',
  version: '1.12.2'
}, {
  linkOnConnect: true,
  startOnLogin: true,
  stopOnLogoff: true
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
