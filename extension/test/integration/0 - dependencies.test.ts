import * as assert from 'assert'
import * as depInstaller from '../../src/dependency-installer/dependency-installer'
import { MaxTimeout } from '../globals'
import * as os from 'os'

// Note: Dependency installation must run before other integration tests
suite('Dependency Installer', () => {
  if (process.env.DEPENDENCIES_INSTALLED !== 'true') {
    test('Install Missing Dependencies', async () => {
      const dependencyManager = new depInstaller.DependencyInstaller()
      await assert.doesNotReject(async () => { await dependencyManager.installMissing() })

      // If not on Windows, check that all dependencies are installed
      if (os.platform() !== 'win32') {
        // Check that all dependencies are installed
        await dependencyManager.checkDependencies()
        assert.deepStrictEqual(await dependencyManager.missingDependencies.getValue(), [])
      }
    }).timeout(MaxTimeout)
  } else {
    test('Dependencies Installed', async () => {
      const dependencyManager = new depInstaller.DependencyInstaller()
      await dependencyManager.checkDependencies()
      assert.deepStrictEqual(await dependencyManager.missingDependencies.getValue(), [])
    })
  }
})
