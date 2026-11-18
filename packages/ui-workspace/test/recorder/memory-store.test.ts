import { memoryStore } from '../../src/recorder/memory-store.ts'
import { storeContract } from './store-contract.ts'

storeContract(max => memoryStore({ max }))
