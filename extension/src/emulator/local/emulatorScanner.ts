import portScanner = require('portscanner-sync')
import awaitToJs = require('await-to-js')
import find = require('find-process')
import { window } from 'vscode'
import * as Config from './config'
import os = require('os')
import { promisify } from 'util'
import { exec } from 'child_process'
const promisifyExec = promisify(exec)

let showLocationWarning = true

export async function emulatorExists (): Promise<boolean> {
  const defaultHost = '127.0.0.1'
  const defaultPort = 3569
  const [err, status] = await awaitToJs.to(portScanner.checkPortStatus(defaultPort, defaultHost))
  if (err != null) {
    console.error(err)
    return false
  }

  if (status !== 'open') {
    showLocationWarning = true
    return false
  }

  // Only connect to emulator if running in same dir as flow.json or else LS will crash
  if (!await validEmulatorLocation()) {
    if (showLocationWarning) {
      void window.showWarningMessage(`Emulator detected running in a different directory than your flow.json 
      config. To connect an emulator, please run 'flow emulator' in the same directory as your flow.json`)
      showLocationWarning = false // Avoid spamming the location warning
    }
    return false
  }

  showLocationWarning = true

  return true
}

export async function validEmulatorLocation (): Promise<boolean> {
  const configPath = await Config.getConfigPath()
  const flowJsonDir = configPath.substring(0, configPath.lastIndexOf('/'))
  let emulatorDir: string | undefined

  switch (os.platform()) {
    case 'darwin':
    case 'linux':
      emulatorDir = await emulatorRunPath()
      break
    case 'win32': // No nice way to find location on Windows
    default:
      console.log('Cannot verify emulator location on', os.platform())
      return true // Allow connections to any emulator
  }

  return emulatorDir === flowJsonDir
}

export async function emulatorRunPath (): Promise<string | undefined> {
  try {
    const emuProccessInfo = (await find('name', 'flow emulator'))
    const output = await promisifyExec(`lsof -p ${emuProccessInfo[0].pid} | grep cwd`)
    const cwdIndex = 8 // Runpath dir index in lsof command
    const emulatorPath: string = output.stdout.trim().split(/\s+/)[cwdIndex]
    return emulatorPath
  } catch (err) {
    return undefined
  }
}
