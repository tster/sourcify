/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';
import { SourcifyChain } from '../src/lib/types';
import Web3 from 'web3';
import Ganache from 'ganache';
import {
  /* callContractMethodWithTx, */
  checkAndVerifyDeployed,
  checkFilesFromContractFolder,
  deployCheckAndVerify,
  deployFromAbiAndBytecode,
  expectMatch,
} from './utils';
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import {
  calculateCreate2Address,
  /* 
  getBytecode,
  matchWithSimulation,
  */
  matchWithCreationTx,
  replaceImmutableReferences,
  verifyCreate2,
  verifyDeployed,
} from '../src';
import fs from 'fs';
// import { Match } from '@ethereum-sourcify/lib-sourcify';

const ganacheServer = Ganache.server({
  wallet: { totalAccounts: 1 },
  chain: { chainId: 0, networkId: 0 },
});
const GANACHE_PORT = 8545;

const UNUSED_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // checksum valid

const sourcifyChainGanache: SourcifyChain = {
  name: 'ganache',
  shortName: 'ganache',
  chainId: 0,
  networkId: 0,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpc: [`http://localhost:${GANACHE_PORT}`],
  monitored: false,
  supported: true,
};

let localWeb3Provider: Web3;
let accounts: string[];

describe('lib-sourcify tests', () => {
  before(async () => {
    await ganacheServer.listen(GANACHE_PORT);
    localWeb3Provider = new Web3(`http://localhost:${GANACHE_PORT}`);
    accounts = await localWeb3Provider.eth.getAccounts();
  });

  describe('Verification tests', () => {
    it('should verify a simple contract', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Storage');
      const { match, deployedAddress } = await deployCheckAndVerify(
        contractFolderPath,
        sourcifyChainGanache,
        localWeb3Provider,
        accounts[0]
      );
      expectMatch(match, 'perfect', deployedAddress);
    });

    it('should partially verify a simple contract', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Storage');
      const modifiedContractFolderPath = path.join(
        __dirname,
        'sources',
        'StorageModified'
      );
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0]
      );
      const match = await checkAndVerifyDeployed(
        modifiedContractFolderPath, // Using the modified contract
        sourcifyChainGanache,
        deployedAddress
      );

      expectMatch(match, 'partial', deployedAddress);
    });

    it('should fail to verify a different simple contract', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Storage');
      const wrongContractFolderPath = path.join(
        __dirname,
        'sources',
        'UsingLibrary'
      );
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0]
      );
      try {
        await checkAndVerifyDeployed(
          wrongContractFolderPath, // Using the wrong contract
          sourcifyChainGanache,
          deployedAddress
        );
        throw new Error('Should have failed');
      } catch (err) {
        if (err instanceof Error) {
          expect(err.message).to.equal(
            "The deployed and recompiled bytecode don't match."
          );
        } else {
          throw err;
        }
      }
    });

    it('should fail to verify a non-existing address', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Storage');
      const match = await checkAndVerifyDeployed(
        contractFolderPath, // Using the wrong contract
        sourcifyChainGanache,
        UNUSED_ADDRESS
      );
      expectMatch(
        match,
        null,
        UNUSED_ADDRESS,
        undefined,
        `Chain #${sourcifyChainGanache.chainId} does not have a contract deployed at ${UNUSED_ADDRESS}.`
      );
    });

    it('should verify a contract with library placeholders', async () => {
      // Originally https://goerli.etherscan.io/address/0x399B23c75d8fd0b95E81E41e1c7c88937Ee18000#code
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'UsingLibrary'
      );
      const { match, deployedAddress } = await deployCheckAndVerify(
        contractFolderPath,
        sourcifyChainGanache,
        localWeb3Provider,
        accounts[0]
      );
      const expectedLibraryMap = {
        __$da572ae5e60c838574a0f88b27a0543803$__:
          '11fea6722e00ba9f43861a6e4da05fecdf9806b7',
      };
      expectMatch(match, 'perfect', deployedAddress, expectedLibraryMap);
    });

    it('should verify a contract with viaIR:true', async () => {
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'StorageViaIR'
      );
      const { match, deployedAddress } = await deployCheckAndVerify(
        contractFolderPath,
        sourcifyChainGanache,
        localWeb3Provider,
        accounts[0]
      );
      expectMatch(match, 'perfect', deployedAddress);
    });

    it('should verify a contract with immutables', async () => {
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'WithImmutables'
      );
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0],
        ['12345']
      );

      const match = await checkAndVerifyDeployed(
        contractFolderPath,
        sourcifyChainGanache,
        deployedAddress
      );
      expectMatch(match, 'perfect', deployedAddress);
    });

    it('should verify a create2 contract', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Create2');
      const checkedContracts = await checkFilesFromContractFolder(
        contractFolderPath
      );
      const saltNum = 12345;
      const saltHex = '0x' + saltNum.toString(16);
      const match = await verifyCreate2(
        checkedContracts[0],
        '0xd9145CCE52D386f254917e481eB44e9943F39138',
        saltHex,
        '0x801B9c0Ee599C3E5ED60e4Ec285C95fC9878Ee64',
        '0x0000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc40000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc4'
      );
      expectMatch(
        match,
        'perfect',
        '0x801B9c0Ee599C3E5ED60e4Ec285C95fC9878Ee64'
      );
    });

    it('should verify fail to a create2 contract with wrong address', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Create2');
      const checkedContracts = await checkFilesFromContractFolder(
        contractFolderPath
      );
      const saltNum = 12345;
      const saltHex = '0x' + saltNum.toString(16);
      try {
        await verifyCreate2(
          checkedContracts[0],
          '0xd9145CCE52D386f254917e481eB44e9943F39138',
          saltHex,
          UNUSED_ADDRESS,
          '0x0000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc40000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc4'
        );
      } catch (err) {
        if (err instanceof Error) {
          expect(err.message).to.equal(
            `The provided create2 address doesn't match server's generated one. Expected: 0x801B9c0Ee599C3E5ED60e4Ec285C95fC9878Ee64 ; Received: ${UNUSED_ADDRESS} ;`
          );
        } else {
          throw err;
        }
      }
    });
    // https://github.com/ethereum/sourcify/issues/640
    it('should remove the inliner option from metadata for solc >=0.8.2 to <=0.8.4 and be able to verify', async () => {
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'StorageInliner'
      );
      const { match, deployedAddress } = await deployCheckAndVerify(
        contractFolderPath,
        sourcifyChainGanache,
        localWeb3Provider,
        accounts[0]
      );
      expectMatch(match, 'perfect', deployedAddress);
    });

    /* it('should verify a contract created by a factory contract and has immutables', async () => {
      const deployValue = 12345;
      const childFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutable',
        'Child'
      );
      const factoryFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutable',
        'Factory'
      );
      const [factoryAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        factoryFolderPath,
        accounts[0],
        [deployValue]
      );

      // Deploy the child by calling the factory
      const txReceipt = await callContractMethodWithTx(
        localWeb3Provider,
        factoryFolderPath,
        factoryAddress,
        'deploy',
        accounts[0],
        [deployValue]
      );
      const childAddress = txReceipt.events.Deployment.returnValues[0];
      const abiEncoded = localWeb3Provider.eth.abi.encodeParameter(
        'uint',
        deployValue
      );
      const match = await checkAndVerifyDeployed(
        childFolderPath,
        sourcifyChainGanache,
        childAddress,
        {
          abiEncodedConstructorArguments: abiEncoded,
        }
      );

      expectMatch(match, 'perfect', childAddress);
    }); */

    /* it('should verify a contract created by a factory contract and has immutables without constructor arguments but with msg.sender assigned immutable', async () => {
      const childFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutableWithoutConstrArg',
        'Child'
      );
      const factoryFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutableWithoutConstrArg',
        'Factory'
      );
      const [factoryAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        factoryFolderPath,
        accounts[0],
        []
      );

      // Deploy the child by calling the factory
      const txReceipt = await callContractMethodWithTx(
        localWeb3Provider,
        factoryFolderPath,
        factoryAddress,
        'createChild',
        accounts[0],
        []
      );
      const childAddress = txReceipt.events.ChildCreated.returnValues[0];
      const match = await checkAndVerifyDeployed(
        childFolderPath,
        sourcifyChainGanache,
        childAddress,
        {
          msgSender: factoryAddress,
        }
      );

      expectMatch(match, 'perfect', childAddress);
    });
    */
    it('should fully verify a contract which is originally compiled and deployed with Unix style End Of Line (EOL) source code, but being verified with Windows style (CRLF) EOL source code', async () => {
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'WrongMetadata'
      );
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0]
      );

      const match = await checkAndVerifyDeployed(
        contractFolderPath,
        sourcifyChainGanache,
        deployedAddress
      );
      expectMatch(match, 'perfect', deployedAddress);
    });

    it('should fully verify a contract when a not alphabetically sorted metadata is provided', async () => {
      const contractFolderPath = path.join(__dirname, 'sources', 'Storage');
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0]
      );

      const checkedContracts = await checkFilesFromContractFolder(
        contractFolderPath
      );

      // Get the unsorted metadata
      const metadataPath = path.join(
        path.join(__dirname, 'sources', 'StorageUnsortedMetadata'),
        'metadata.json'
      );
      const metadataBuffer = fs.readFileSync(metadataPath);

      // Replace the metadata witht he unsorted one
      checkedContracts[0].initSolcJsonInput(
        JSON.parse(metadataBuffer.toString()),
        checkedContracts[0].solidity
      );

      const match = await verifyDeployed(
        checkedContracts[0],
        sourcifyChainGanache,
        deployedAddress
      );
      expectMatch(match, 'perfect', deployedAddress);
    });
  });

  describe('Unit tests', function () {
    it('Should calculateCreate2Address', async function () {
      expect(
        calculateCreate2Address(
          '0x71CB05EE1b1F506fF321Da3dac38f25c0c9ce6E1',
          '123',
          '0x00'
        )
      ).equals('0xA0279ea82DF644AFb68FdD4aDa5848C5Df9F116B');
    });

    it('Should replaceImmutableReferences', async function () {
      const deployedBytecode =
        '0x608060405234801561001057600080fd5b50600436106100415760003560e01c806357de26a41461004657806379d6348d146100c9578063ced7b2e314610184575b600080fd5b61004e6101a2565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561008e578082015181840152602081019050610073565b50505050905090810190601f1680156100bb5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b610182600480360360208110156100df57600080fd5b81019080803590602001906401000000008111156100fc57600080fd5b82018360208201111561010e57600080fd5b8035906020019184600183028401116401000000008311171561013057600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290505050610244565b005b61018c61025e565b6040518082815260200191505060405180910390f35b606060008054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561023a5780601f1061020f5761010080835404028352916020019161023a565b820191906000526020600020905b81548152906001019060200180831161021d57829003601f168201915b5050505050905090565b806000908051906020019061025a929190610282565b5050565b7f000000000000000000000000000000000000000000000000000000000000000281565b828054600181600116156101000203166002900490600052602060002090601f0160209004810192826102b857600085556102ff565b82601f106102d157805160ff19168380011785556102ff565b828001600101855582156102ff579182015b828111156102fe5782518255916020019190600101906102e3565b5b50905061030c9190610310565b5090565b5b80821115610329576000816000905550600101610311565b509056fea26469706673582212207d766cdc8c3a27e3071e5fbe3fb4327a900c77e0061b473bd4d024da7b147ee564736f6c63430007040033';

      const recompiledDeployedBytecode =
        '0x608060405234801561001057600080fd5b50600436106100415760003560e01c806357de26a41461004657806379d6348d146100c9578063ced7b2e314610184575b600080fd5b61004e6101a2565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561008e578082015181840152602081019050610073565b50505050905090810190601f1680156100bb5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b610182600480360360208110156100df57600080fd5b81019080803590602001906401000000008111156100fc57600080fd5b82018360208201111561010e57600080fd5b8035906020019184600183028401116401000000008311171561013057600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290505050610244565b005b61018c61025e565b6040518082815260200191505060405180910390f35b606060008054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561023a5780601f1061020f5761010080835404028352916020019161023a565b820191906000526020600020905b81548152906001019060200180831161021d57829003601f168201915b5050505050905090565b806000908051906020019061025a929190610282565b5050565b7f000000000000000000000000000000000000000000000000000000000000000081565b828054600181600116156101000203166002900490600052602060002090601f0160209004810192826102b857600085556102ff565b82601f106102d157805160ff19168380011785556102ff565b828001600101855582156102ff579182015b828111156102fe5782518255916020019190600101906102e3565b5b50905061030c9190610310565b5090565b5b80821115610329576000816000905550600101610311565b509056fea26469706673582212207d766cdc8c3a27e3071e5fbe3fb4327a900c77e0061b473bd4d024da7b147ee564736f6c63430007040033';
      const immutableReferences = {
        '3': [
          {
            length: 32,
            start: 608,
          },
        ],
      };

      const replacedBytecode = replaceImmutableReferences(
        immutableReferences,
        deployedBytecode
      );

      expect(replacedBytecode).equals(recompiledDeployedBytecode);
    });

    /* 
    it('should matchWithSimulation', async () => {
      const childFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutableWithoutConstrArg',
        'Child'
      );
      const factoryFolderPath = path.join(
        __dirname,
        'sources',
        'FactoryImmutableWithoutConstrArg',
        'Factory'
      );
      const [factoryAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        factoryFolderPath,
        accounts[0],
        []
      );

      // Deploy the child by calling the factory
      const txReceipt = await callContractMethodWithTx(
        localWeb3Provider,
        factoryFolderPath,
        factoryAddress,
        'createChild',
        accounts[0],
        []
      );
      const childAddress = txReceipt.events.ChildCreated.returnValues[0];

      const checkedContracts = await checkFilesFromContractFolder(
        childFolderPath
      );
      const recompiled = await checkedContracts[0].recompile();
      const deployedBytecode = await getBytecode(
        sourcifyChainGanache,
        childAddress
      );
      const evmVersion = JSON.parse(recompiled.metadata).settings.evmVersion;
      const match: Match = {
        address: childAddress,
        chainId: sourcifyChainGanache.chainId.toString(),
        status: null,
      };

      await matchWithSimulation(
        match,
        recompiled.creationBytecode,
        deployedBytecode,
        evmVersion,
        sourcifyChainGanache.chainId.toString(),
        {
          msgSender: factoryAddress,
        }
      );

      expectMatch(match, 'perfect', childAddress);
    });
    */

    it('should fail to matchWithCreationTx with wrong creationTxHash', async () => {
      const contractFolderPath = path.join(
        __dirname,
        'sources',
        'WithImmutables'
      );
      const [deployedAddress] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0],
        ['12345']
      );
      const [, wrongCreatorTxHash] = await deployFromAbiAndBytecode(
        localWeb3Provider,
        contractFolderPath,
        accounts[0],
        ['12345']
      );

      const checkedContracts = await checkFilesFromContractFolder(
        contractFolderPath
      );
      const recompiled = await checkedContracts[0].recompile();
      const match = {
        address: deployedAddress,
        chainId: sourcifyChainGanache.chainId.toString(),
        status: null,
      };
      await matchWithCreationTx(
        match,
        recompiled.creationBytecode,
        sourcifyChainGanache,
        deployedAddress,
        wrongCreatorTxHash
      );
      expectMatch(match, null, deployedAddress, undefined); // status is null
    });
  });
});
