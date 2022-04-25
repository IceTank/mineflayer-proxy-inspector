# Mineflayer proxy inspector
Proxys your connection into a server by taking control away from the bot and giving it to your client. Works with 1.12.2 (and 1.18.2 soon TM)

## Note
Currently requires a special fork off [mcproxy](https://github.com/rob9315/mcproxy) that can be found [here](https://github.com/IceTank/mcproxy-1/tree/middleware)

## Features
- World persistance (World is loaded from the bots memory when joining)
- Real time packet interception and editing
- 'Spactator' mode. See the bot running around as a fake player.

## Api usage
### makeBot(options: BotOptions, proxyOptions?: ProxyOptions)
Make a new bot with bot options like mineflayer's createBot function. Automatically creates the proxy server once the bot has joined a game.
- `Returns` - A mcproxy `Conn` instance. Has the underlying bot instance as `Conn.bot` accessible. This can be used to program the bot like any other mineflayer bot.
- `options` - An Object containing mineflayer's bot options.
- `proxyOptions` - Optional. An Object containing the proxy Options.
  - `port` - Optional, defaults to `25566`. The port the proxy server should run on. Is used when joining the bots world with your client (Ie. connect to `localhost:<port>`).
  - `motd` - Optional. The motd on the proxy server. 

## Installation as a node.js module
1. Run `npm install https://github.com/IceTank/mineflayer-proxy-inspector` (it is not on npm yet)
