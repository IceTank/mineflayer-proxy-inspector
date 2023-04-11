# Mineflayer proxy inspector
High level Minecraft proxy with Node.js API.
Creates a mineflayer bot that acts as a proxy at the same time. Works with 1.12.2 (and 1.18.2 soon TM)

# Install
1. Install [git](https://git-scm.com/)
2. Install [yarn](https://yarnpkg.com/) (npm may not work)
2. Run `yarn add mineflayer-proxy-inspector` to add it to your project

# Features
- World persistance (World is loaded from the bots memory when joining)
- Real time packet interception and editing
- 'Spactator' mode. See the bot running around as a fake player.
- Multi player support. Can give control off the connection to any connected client.

# Api usage

## Class `InspectorProxy(botOptions, proxyOptions)`
Makes a new Inspector Proxy class.
- `botOptions` - Mineflayer bot options for the bot that will be created. Specify the host and port you want to make the proxy join here.
- `proxyOptions`
  - `port` Optional. Defaults to 25566. Port the proxy server will run on. When joining with the proxy join this port.
  - `motd` Optional. Motd to set for the proxy server.
  - `security` Optional. Object
    - `onlineMode` Optional. Defaults to `false`. Check incoming accounts for online mode.
    - `allowList` Optional. Array off strings with allowed player names. Or a callback that takes a name and returns a boolean value. If not set all players are allowed to join.
    - `kickMessage` Optional. String to set as the kicked message if player is not allowed to join.
  - `linkOnConnect` Optional. Defaults to `true`. Automatically link connecting clients to the bot or not.
  - `autoStartBotOnServerLogin` Optional. Defaults to `true`. Automatically start the bot if not started when someone tries to connect to the proxy server.
  - `botAutoStart` Optional. Defaults to `true`. Auto start the bot on Class instantiation.
  - `botStopOnLogoff` Optional. Defaults to `true`. Auto stop the bot when the last user disconnects from the proxy.
  - `serverAutoStart` Optional. Defaults to `true`. Auto start the server on Class instantiation.
  - `serverStopOnBotStop` Optional. Defaults to `false`. Auto stop the server when the bot disconnects.
  - `logPlayerJoinLeave` Optional. Defaults to `false`. Logs when players join or leave the proxy. 
  - `disconnectAllOnEnd` Optional. Defaults to `true`. Logs off all connected proxy connections when the bot disconnects.
  - `disabledCommands` Optional. Defaults to `false`. Disables all in game commands.
  - `toClientMiddlewares` Optional. Array off additional middlewares to register for each client's packets going from server to client.
  - `toServerMiddlewares` Optional. Array off additional middlewares to register for each client's packets going from client to server.
  - `worldCaching` Optional. Defaults to `true`. If `false` deactivates world caching.

### `botIsInControl()`
Returns true when no client is currently controlling the proxy

### `async startBot()`
Starts the bot with `botOptions` options
`Returns` - A promise that resolves when the bot is ready.

### `stopBot()`
Stops the bot

### `stopServer()`
Stops the proxy server

### `startServer()`
Starts the proxy server with `proxyOptions` options

### `message(client, message, prefix?, allowFormatting?, position?)`
Send a message to a given client
- `client` - The client to send the message to
- `message`. String message to send to clients
- `prefix` Optional. Defaults to `true`. Display the proxy message prefix `proxyChatPrefix` before messages.
- `allowFormatting` Optional. Defaults to `true`. Allow formatting characters in the message (for instance `§e §3`)
- `position` Optional. Defaults to `0` (chat). Number position to display the text in. Can be `0` `1` or `2`

### `broadcastMessage(message, prefix?, allowFormatting?, position?)`
Sends a message to all connected clients
- `message`. String message to send to clients
- `prefix` Optional. Defaults to `true`. Display the proxy message prefix `proxyChatPrefix` before messages.
- `allowFormatting` Optional. Defaults to `true`. Allow formatting characters in the message (for instance `§e §3`)
- `position` Optional. Defaults to `0` (chat). Number position to display the text in. Can be `0` `1` or `2`

### `printHelp(client)`
Prints the build in commands to the given client as chat messages
- `client` - The client to send the messages to

### `attach(client)`
Attach a specific client to the proxy. This makes the client receive packets send by the server. This is done internally automatically and should not be used unless you know what you are doing.
- `client` - The client to connect to

### `link(client)`
Links the given client into the current connection. This makes this client control the bot and the connection until it is unlinked again or disconnects.
- `client` - The client

### `unlink(client`)`
Opposite of `link`
- `client` - Optional. The client to unlink.

### `sendPackets(client)`
Send packets needed to synchronize a newly connected client with the world state to the proxy. This is done automatically and should not be used unless you know what you are doing.
- `client` - The client to send packets to

### `makeViewFakePlayer(client)`
Looks a clients view into the view off the bot. Only works when the client is not controlling the bot. Does nothing otherwise.
- `returns` - A boolean value if a client has been looked into a view or not

### `makeViewNormal(client)`
Reset the effects off `makeViewFakePlayer`
- `returns` - A boolean value if the view off the client has been changed or not.

### `setMotd(line1, line2?)`
Set the motd message for the proxy server.
- `line1` - String. Line one off the motd message
- `line2` - Optional. Defaults to an empty string. Line two off the motd message

### `setChatMessageMotd(message)`
Set the motd message as a chat message element
- `message` - Instance of `prismarine-chat`. The ChatMessage instance to set as the motd.

## `sendMessage(client)`
Sends a message to a given client. Works the same as `{InspectorProxy}.sendMessage` but can be used to send messages to any client instance.

## (deprecated) `makeBot(options: BotOptions, proxyOptions?: ProxyOptions)`
Make a new bot with bot options like mineflayer's createBot function. Automatically creates the proxy server once the bot has joined a game.
- `Returns` - A mcproxy `Conn` instance. Has the underlying bot instance as `Conn.bot` accessible. This can be used to program the bot like any other mineflayer bot.
- `options` - An Object containing mineflayer's bot options.
- `proxyOptions` - Optional. An Object containing the proxy Options.
  - `port` - Optional, defaults to `25566`. The port the proxy server should run on. Is used when joining the bots world with your client (Ie. connect to `localhost:<port>`).
  - `motd` - Optional. The motd on the proxy server. 
