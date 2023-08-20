import { Vec3 } from "vec3";
import { Client, ServerClient } from "minecraft-protocol";
import { GameState } from "mineflayer";
import { performance } from "perf_hooks";
const ChatMessage = require('prismarine-chat')('1.12.2')
import { EventEmitter } from 'events'
import { setTimeout as timeoutPromise } from 'timers/promises'

export const NoneItemData = {
  blockId: -1,
  itemCount: undefined,
  itemDamage: undefined,
  nbtData: undefined
}

export class FakeEntity {
  knownPosition: Vec3
  lastSendPos: number
  yaw: number
  pitch: number
  oldYaw: number
  oldPitch: number
  onGround: boolean
  mainHand?: object
  offHand?: object
  armor: Array<object | undefined>
  constructor(pos: Vec3, yaw: number, pitch: number) {
    this.knownPosition = pos
    this.yaw = yaw
    this.pitch = pitch
    this.oldYaw = yaw
    this.oldPitch = pitch
    this.onGround = true
    this.lastSendPos = performance.now()
    this.armor = []
  }
}

export function sendMessage(client: ServerClient | Client, message: string, position: number = 1) {
  const messageObj = new ChatMessage(message)
  client.write('system_chat', { content: messageObj.json.toString(), position })
}

export async function sleep(ms: number) {
  await timeoutPromise(ms)
}

function gamemodeToNumber(str: GameState["gameMode"]) {
  if (str === 'survival') {
    return 0
  } else if (str === 'creative') {
    return 1
  } else if (str === 'adventure') {
    return 2
  } else if (str === 'spectator') {
    return 3
  }
}

function createTask() {
  const task: {
    done: boolean,
    promise: Promise<void>,
    cancel: Function,
    finish: Function
  } = {
    done: false,
    promise: new Promise(() => { }),
    cancel: () => ({}),
    finish: () => ({})
  }
  task.promise = new Promise((resolve, reject) => {
    task.cancel = (err: any) => {
      if (!task.done) {
        task.done = true
        reject(err)
      }
    }
    task.finish = (result: any) => {
      if (!task.done) {
        task.done = true
        resolve(result)
      }
    }
  })
  return task
}

export function onceWithCleanup(emitter: EventEmitter, event: string, { timeout = 0, checkCondition = undefined }: { timeout?: number, checkCondition?: Function } = {}): Promise<unknown> {
  const task = createTask()

  const onEvent = (...data: any[]) => {
    if (typeof checkCondition === 'function' && !checkCondition(...data)) {
      return
    }

    task.finish(data)
  }

  emitter.addListener(event, onEvent)

  if (typeof timeout === 'number' && timeout > 0) {
    // For some reason, the call stack gets lost if we don't create the error outside of the .then call
    const timeoutError = new Error(`Event ${event} did not fire within timeout of ${timeout}ms`)
    timeoutPromise(timeout).then(() => {
      if (!task.done) {
        task.cancel(timeoutError)
      }
    })
  }

  task.promise.finally(() => emitter.removeListener(event, onEvent)).catch(err => { })

  return task.promise
}
