import { LanguageClient, State } from 'vscode-languageclient/node'
import { window } from 'vscode'
import { Account } from '../account'
import { emulatorStateChanged } from '../../main'
import * as Config from '../local/flowConfig'
import { Settings } from '../../settings/settings'
import * as response from './responses'
import { exec } from 'child_process'
import { verifyEmulator } from '../local/emulatorScanner'
import { ExecuteCommandRequest } from 'vscode-languageclient'
import { BehaviorSubject, combineLatest, map } from 'rxjs'

// Identities for commands handled by the Language server
const CREATE_ACCOUNT_SERVER = 'cadence.server.flow.createAccount'
const SWITCH_ACCOUNT_SERVER = 'cadence.server.flow.switchActiveAccount'
const GET_ACCOUNTS_SERVER = 'cadence.server.flow.getAccounts'
const RELOAD_CONFIGURATION = 'cadence.server.flow.reloadConfiguration'

export enum EmulatorState {
  Connected,
  Connecting,
  Disconnected,
}
export class LanguageServerAPI {
  client: LanguageClient | null = null
  settings: Settings

  clientState$ = new BehaviorSubject<State>(State.Stopped)
  flowEnabled$ = new BehaviorSubject<boolean>(false)
  emulatorState$ = new BehaviorSubject<EmulatorState>(EmulatorState.Disconnected)

  constructor (settings: Settings) {
    this.settings = settings

    // Map client state to emulator state
    combineLatest({ clientState: this.clientState$, flowEnabled: this.flowEnabled$ }).pipe(
      map(({ clientState, flowEnabled }) => {
        // Emulator will always be disconnected if not using flow
        if (!flowEnabled) return EmulatorState.Disconnected

        if (clientState === State.Running) {
          return EmulatorState.Connected
        } else if (clientState === State.Starting) {
          return EmulatorState.Connecting
        } else {
          return EmulatorState.Disconnected
        }
      })
    ).subscribe(this.emulatorState$.next)

    // Subscribe to emulator state changes
    this.emulatorState$.subscribe(emulatorStateChanged)

    void this.startClient()
    void this.watchEmulator()
  }

  async deactivate (): Promise<void> {
    await this.client?.stop()
      .catch((err) => { console.log(err) })
  }

  watchEmulator (): void {
    const pollingIntervalMs = 1000

    // Loop with setTimeout to avoid overlapping calls
    void (async function loop (this: LanguageServerAPI) {
      try {
        // Wait for client to connect or disconnect
        if (this.clientState$.getValue() === State.Starting) return

        // Check if emulator state has changed
        const emulatorFound = await verifyEmulator()
        if ((this.emulatorState$.getValue() === EmulatorState.Connected) === emulatorFound) {
          return // No changes in local emulator state
        }

        // Restart language server
        await this.restart(emulatorFound)
      } catch (err) {
        console.log(err)
      } finally {
        setTimeout(loop.bind(this), pollingIntervalMs)
      }
    }.bind(this))()
  }

  async startClient (enableFlow?: boolean): Promise<void> {
    // Prevent starting multiple times
    if (this.clientState$.getValue() !== State.Stopped) {
      throw new Error("Can't start client while already starting or started")
    }

    // Resolve whether to use flow and assign state
    if (enableFlow === undefined) {
      enableFlow = await verifyEmulator()
    }
    this.flowEnabled$.next(enableFlow)

    const numberOfAccounts: number = this.settings.numAccounts
    const accessCheckMode: string = this.settings.accessCheckMode
    let configPath = this.settings.customConfigPath

    if (configPath === '' || configPath === undefined) {
      configPath = await Config.getConfigPath()
    }

    if (this.settings.flowCommand !== 'flow') {
      try {
        exec('killall dlv') // Required when running language server locally on mac
      } catch (err) { void err }
    }

    this.client = new LanguageClient(
      'cadence',
      'Cadence',
      {
        command: this.settings.flowCommand,
        args: ['cadence', 'language-server', `--enable-flow-client=${String(enableFlow)}`]
      },
      {
        documentSelector: [{ scheme: 'file', language: 'cadence' }],
        synchronize: {
          configurationSection: 'cadence'
        },
        initializationOptions: {
          configPath,
          numberOfAccounts: `${numberOfAccounts}`,
          accessCheckMode
        }
      }
    )

    await this.client.start()
      .then(() => {
        this.clientState$.next(State.Running)
        this.watchFlowConfiguration()
      })
      .catch((err: Error) => {
        this.clientState$.next(State.Stopped)
        void window.showErrorMessage(`Cadence language server failed to start: ${err.message}`)
      })

    if (!enableFlow) {
      void window.showWarningMessage(`Couldn't connect to emulator. Run 'flow emulator' in a terminal 
      to enable all extension features. If you want to deploy contracts, send transactions or execute 
      scripts you need a running emulator.`)
    } else {
      void window.showInformationMessage('Flow Emulator Connected')
    }
  }

  async stopClient (): Promise<void> {
    // Set emulator state to disconnected
    this.clientState$.next(State.Stopped)

    await this.client?.stop()
    this.client = null
  }

  async restart (enableFlow: boolean): Promise<void> {
    // Prevent restarting multiple times
    await this.stopClient()
    await this.startClient(enableFlow)
  }

  emulatorConnected (): boolean {
    return this.emulatorState$.getValue() === EmulatorState.Connected
  }

  async #sendRequest (cmd: string, args: any[] = []): Promise<any> {
    return await this.client?.sendRequest(ExecuteCommandRequest.type, {
      command: cmd,
      arguments: args
    })
  }

  async reset (): Promise<void> {
    const enableFlow = await verifyEmulator()
    await this.restart(enableFlow)
  }

  // Sends a request to switch the currently active account.
  async switchActiveAccount (account: Account): Promise<void> {
    return await this.#sendRequest(SWITCH_ACCOUNT_SERVER, [account.name])
  }

  // Watch and reload flow configuration when changed.
  watchFlowConfiguration (): void {
    void Config.watchFlowConfigChanges(async () => await this.#sendRequest(RELOAD_CONFIGURATION))
  }

  // Sends a request to create a new account. Returns the address of the new
  // account, if it was created successfully.
  async createAccount (): Promise<Account> {
    try {
      const res: any = await this.#sendRequest(CREATE_ACCOUNT_SERVER)
      return new response.ClientAccount(res).asAccount()
    } catch (err) {
      if (err instanceof Error) {
        window.showErrorMessage(`Failed to create account: ${err.message}`)
          .then(() => {}, () => {})
      }
      throw err
    }
  }

  // Sends a request to obtain all account mappings, addresses, names, and active status
  async getAccounts (): Promise<response.GetAccountsReponse> {
    const res = await this.#sendRequest(GET_ACCOUNTS_SERVER)
    return new response.GetAccountsReponse(res)
  }
}
