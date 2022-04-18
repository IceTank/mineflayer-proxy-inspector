const { makeBot } = require('../')

const conn = makeBot({
  host: 'localhost',
  username: 'proxyBot',
  version: '1.12.2'
})

conn.bot.on('spawn', () => {
  console.info('Bot spawned')
})

conn.bot._client.on('packet', (data, packetMeta) => {
  if (packetMeta.name === 'unlock_recipes') { // This packet is blocked because it is causing issues on 2beeetwoteee
    console.info(data)
  }
})