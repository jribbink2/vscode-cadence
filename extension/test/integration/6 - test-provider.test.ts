import { beforeEach, afterEach } from 'mocha'
import { TestProvider } from '../../src/test-provider/test-provider'
import { Settings } from '../../src/settings/settings'
import { FlowConfig } from '../../src/server/flow-config'
import { of } from 'rxjs'
import * as path from 'path'
import * as vscode from 'vscode'
import * as sinon from 'sinon'
import * as assert from 'assert'
import * as fs from 'fs'
import { getMockSettings } from '../mock/mockSettings'

const workspacePath = path.resolve(__dirname, './fixtures/workspace')

suite('test provider tests', () => {
  let mockSettings: Settings
  let mockConfig: FlowConfig
  let testProvider: TestProvider
  let cleanupFunctions: Array<() => void | Promise<void>> = []

  beforeEach(async function () {
    this.timeout(5000)

    const parserLocation = path.resolve(__dirname, '../../../../node_modules/@onflow/cadence-parser/dist/cadence-parser.wasm')

    mockSettings = getMockSettings({
      flowCommand: 'flow',
      test: {
        maxConcurrency: 1
      }
    })
    mockConfig = {
      fileModified$: of(),
      pathChanged$: of(),
      configPath: path.join(workspacePath, 'flow.json')
    } as any

    testProvider = new TestProvider(parserLocation, mockSettings, mockConfig)

    // Wait for test provider to initialize
    await new Promise((resolve) => setTimeout(resolve, 2500))
  })

  afterEach(async function () {
    this.timeout(5000)

    testProvider.dispose()
    for (const cleanupFunction of cleanupFunctions) {
      await cleanupFunction()
    }
    cleanupFunctions = []
  })

  test('runs all tests in workspace and reports results', async function () {
    let runSpy: sinon.SinonSpiedInstance<vscode.TestRun> | undefined

    await new Promise<void>(resolve => {
      void testProvider.runAllTests(undefined, (testRun) => {
        const originalEnd = testRun.end
        testRun.end = () => {
          originalEnd.call(testRun)
          resolve()
        }

        runSpy = sinon.spy(testRun)
        return runSpy
      })
    })

    if (runSpy == null) throw new Error('runSpy is null')

    const passedTests = runSpy.passed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id }))
    const failedTests = runSpy.failed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id, message: (call.args[1] as any).message }))

    passedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))
    failedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))

    assert.strictEqual(passedTests.length + failedTests.length, 5)
    assert.deepStrictEqual(passedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/bar/test3.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/test1.cdc'), id: ':testPassing' }
    ])
    assert.deepStrictEqual(failedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testFailing', message: 'FAIL: Execution failed:\nerror: assertion failed\n --> 7465737400000000000000000000000000000000000000000000000000000000:8:2\n' },
      { filepath: path.join(workspacePath, 'test/bar/test3.cdc'), id: ':testFailing', message: 'FAIL: Execution failed:\nerror: assertion failed\n --> 7465737400000000000000000000000000000000000000000000000000000000:4:2\n' }
    ])
  }).timeout(20000)

  test('runs individual test and reports results', async function () {
    let runSpy: sinon.SinonSpiedInstance<vscode.TestRun> | undefined

    await new Promise<void>(resolve => {
      void testProvider.runIndividualTest(path.join(workspacePath, 'test/test1.cdc'), undefined, (testRun) => {
        const originalEnd = testRun.end
        testRun.end = () => {
          originalEnd.call(testRun)
          resolve()
        }

        runSpy = sinon.spy(testRun)
        return runSpy
      })
    })

    if (runSpy == null) throw new Error('runSpy is null')

    const passedTests = runSpy.passed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id }))
    const failedTests = runSpy.failed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id, message: (call.args[1] as any).message }))

    passedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))
    failedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))

    assert.strictEqual(passedTests.length + failedTests.length, 1)
    assert.deepStrictEqual(passedTests, [
      { filepath: path.join(workspacePath, 'test/test1.cdc'), id: ':testPassing' }
    ])
    assert.deepStrictEqual(failedTests, [])
  }).timeout(20000)

  test('runs tests including newly created file', async function () {
    // Create new file
    const testFilePath = path.join(workspacePath, 'test/bar/test4.cdc')
    const testFileContents = `
      import Test
      access(all) fun testPassing() {
        Test.assert(true)
      }
    `
    fs.writeFileSync(testFilePath, testFileContents)
    cleanupFunctions.push(async () => {
      fs.rmSync(testFilePath)
    })
    await new Promise<void>(resolve => setTimeout(resolve, 1000))

    // Run tests
    let runSpy: sinon.SinonSpiedInstance<vscode.TestRun> | undefined
    await new Promise<void>(resolve => {
      void testProvider.runAllTests(undefined, (testRun) => {
        const originalEnd = testRun.end
        testRun.end = () => {
          originalEnd.call(testRun)
          resolve()
        }

        runSpy = sinon.spy(testRun)
        return runSpy
      })
    })
    if (runSpy == null) throw new Error('runSpy is null')

    const passedTests = runSpy.passed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id }))
    const failedTests = runSpy.failed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id, message: (call.args[1] as any).message }))

    passedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))
    failedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))

    assert.strictEqual(passedTests.length + failedTests.length, 6)
    assert.deepStrictEqual(passedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/bar/test3.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/bar/test4.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/test1.cdc'), id: ':testPassing' }
    ])
    assert.deepStrictEqual(failedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testFailing', message: 'FAIL: Execution failed:\nerror: assertion failed\n --> 7465737400000000000000000000000000000000000000000000000000000000:8:2\n' },
      { filepath: path.join(workspacePath, 'test/bar/test3.cdc'), id: ':testFailing', message: 'FAIL: Execution failed:\nerror: assertion failed\n --> 7465737400000000000000000000000000000000000000000000000000000000:4:2\n' }
    ])
  }).timeout(20000)

  test('runs tests including newly deleted file', async function () {
    // Delete test file
    const testFilePath = path.join(workspacePath, 'test/bar/test3.cdc')
    const originalContents = fs.readFileSync(testFilePath)
    fs.rmSync(testFilePath)

    cleanupFunctions.push(async () => {
      fs.writeFileSync(testFilePath, originalContents)
    })
    await new Promise<void>(resolve => setTimeout(resolve, 1000))

    // Run tests
    let runSpy: sinon.SinonSpiedInstance<vscode.TestRun> | undefined
    await new Promise<void>(resolve => {
      void testProvider.runAllTests(undefined, (testRun) => {
        const originalEnd = testRun.end
        testRun.end = () => {
          originalEnd.call(testRun)
          resolve()
        }

        runSpy = sinon.spy(testRun)
        return runSpy
      })
    })
    if (runSpy == null) throw new Error('runSpy is null')

    const passedTests = runSpy.passed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id }))
    const failedTests = runSpy.failed.getCalls().map(call => ({ filepath: (call.args[0].uri as vscode.Uri).fsPath, id: call.args[0].id, message: (call.args[1] as any).message }))

    passedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))
    failedTests.sort((a, b) => a.filepath.localeCompare(b.filepath))

    assert.strictEqual(passedTests.length + failedTests.length, 3)
    assert.deepStrictEqual(passedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testPassing' },
      { filepath: path.join(workspacePath, 'test/test1.cdc'), id: ':testPassing' }
    ])
    assert.deepStrictEqual(failedTests, [
      { filepath: path.join(workspacePath, 'test/bar/test2.cdc'), id: ':testFailing', message: 'FAIL: Execution failed:\nerror: assertion failed\n --> 7465737400000000000000000000000000000000000000000000000000000000:8:2\n' }
    ])
  }).timeout(20000)
})
