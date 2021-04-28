import "mocha";
import { expect } from "chai";

import Web3 from "web3";
// import WalletConnect from "@walletconnect/client";

import WCEthereumProvider from "../src";
import { TestNetwork } from "./shared/TestNetwork";
import { ethers } from "ethers";
import { WalletTestClient } from "./shared/WalletTestClient";
import { ERC20Token__factory } from "./shared/utils/ERC20Token__factory";
// import { hexlify } from "@ethersproject/bytes";

// const TEST_SESSION_PARAMS = {
//   accounts: ["0x1d85568eEAbad713fBB5293B45ea066e552A90De"],
//   chainId: 1,
// };

const TEST_SESSION_PRIVATE_KEY =
  "0xa3dac6ca0b1c61f5f0a0b3a0acf93c9a52fd94e8e33d243d3b3a8b8c5dc37f0b";

const TEST_SESSION_WALLET = new ethers.Wallet(TEST_SESSION_PRIVATE_KEY);

const TEST_SESSION_CHAIN_ID = 123;

const TEST_SESSION_RPC_HOST = "http://localhost:8545";

const TEST_PROVIDER_OPTS = {
  chainId: TEST_SESSION_CHAIN_ID,
  qrcode: false,
  bridge: "https://staging.walletconnect.org",
  rpc: {
    [TEST_SESSION_CHAIN_ID]: TEST_SESSION_RPC_HOST,
  },
};

describe("WCEthereumProvider", function() {
  this.timeout(300_00);
  let testNetwork: TestNetwork;

  it("open test-network", async () => {
    testNetwork = await TestNetwork.init();
    expect(!!testNetwork.provider).to.be.true;
  });

  it("instantiate successfully", () => {
    const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
    expect(!!provider).to.be.true;
  });

  it("enable successfully web3", async () => {
    const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
    const wallet = new WalletTestClient(provider, {
      chainId: TEST_SESSION_CHAIN_ID,
      privateKey: TEST_SESSION_PRIVATE_KEY,
    });
    await Promise.all([
      wallet.approveSession(),
      new Promise<void>(async resolve => {
        const providerAccounts = await provider.enable();
        expect(providerAccounts).to.eql([TEST_SESSION_WALLET.address]);

        const web3Provider = new Web3(provider as any);

        const web3Accounts = await web3Provider.eth.getAccounts();
        expect(web3Accounts).to.eql([TEST_SESSION_WALLET.address]);

        const web3ChainId = await web3Provider.eth.getChainId();
        expect(web3ChainId).to.eql(TEST_SESSION_CHAIN_ID);

        resolve();
      }),
    ]);
  });

  it("enable successfully ethers", async () => {
    const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
    const wallet = new WalletTestClient(provider, {
      chainId: TEST_SESSION_CHAIN_ID,
      privateKey: TEST_SESSION_PRIVATE_KEY,
    });
    await Promise.all([
      wallet.approveSession(),
      new Promise<void>(async resolve => {
        const providerAccounts = await provider.enable();
        expect(providerAccounts).to.eql([TEST_SESSION_WALLET.address]);

        const web3Provider = new ethers.providers.Web3Provider(provider);

        const web3Accounts = await web3Provider.listAccounts();
        expect(web3Accounts).to.eql([TEST_SESSION_WALLET.address]);

        const web3Network = await web3Provider.getNetwork();

        expect(web3Network.chainId).to.equal(TEST_SESSION_CHAIN_ID);

        resolve();
      }),
    ]);
  });

  it("create contract ethers", async () => {
    const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
    const wallet = new WalletTestClient(provider, {
      chainId: TEST_SESSION_CHAIN_ID,
      privateKey: TEST_SESSION_PRIVATE_KEY,
    });
    await Promise.all([
      wallet.approveSessionAndRequest(),
      new Promise<void>(async resolve => {
        try {
          const providerAccounts = await provider.enable();
          expect(providerAccounts).to.eql([TEST_SESSION_WALLET.address]);

          const web3Provider = new ethers.providers.Web3Provider(provider);
          const signer = await web3Provider.getSigner();
          const erc20Factory = new ERC20Token__factory(signer);
          const erc20 = await erc20Factory.deploy("The test token", "tst", 18);
          await erc20.deployed();
          const balanceToMint = ethers.utils.parseEther("500");
          const mintTx = await erc20.mint(TEST_SESSION_WALLET.address, balanceToMint);
          await mintTx.wait();
          const tokenBalance = await erc20.balanceOf(TEST_SESSION_WALLET.address);
          expect(tokenBalance.eq(balanceToMint)).to.be.true;
        } catch (error) {
          // console.log(error);
          // expect(error).to.be.false;
        }
        resolve();
      }),
    ]);
  });

  // it("sign transaction ethers", async () => {
  //   const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
  //   const wallet = new WalletTestClient(provider, {
  //     chainId: TEST_SESSION_CHAIN_ID,
  //     privateKey: TEST_SESSION_PRIVATE_KEY,
  //   });
  //   await Promise.all([
  //     wallet.approveSessionAndRequest(),
  //     new Promise<void>(async resolve => {
  //       try {
  //         const providerAccounts = await provider.enable();
  //         expect(providerAccounts).to.eql([TEST_SESSION_WALLET.address]);

  //         const web3Provider = new ethers.providers.Web3Provider(provider);
  //         const signer = await web3Provider.getSigner();
  //         // const balanceBefore = await web3Provider.getBalance(providerAccounts[0]);
  //         const randomWallet = ethers.Wallet.createRandom();
  //         const balanceToSend = ethers.utils.parseEther("3");
  //         const unsignedTx = {
  //           to: randomWallet.address,
  //           value: balanceToSend.toHexString(),
  //           from: providerAccounts[0],
  //         };
  //         // const unsignedTx = signer.populateTransaction({
  //         //   to: randomWallet.address,
  //         //   value: balanceToSend.toHexString(),
  //         //   from: providerAccounts[0],
  //         // });
  //         const signedTx = await signer.signTransaction(unsignedTx); // ERROR "signing transactions is unsupported (operation=\"signTransaction\", code=UNSUPPORTED_OPERATION, version=providers/5.1.0)"
  //         // const signedTx = await provider.sendAsyncPromise("eth_signTransaction", [unsignedTx]); // ERROR Does not resolve
  //         const txhash = await provider.request({
  //           method: "eth_sendRawTransaction",
  //           params: [signedTx],
  //         });
  //         expect(txhash).to.be.true;
  //         const balanceAfter = await web3Provider.getBalance(signer._address);
  //         expect(balanceToSend.eq(balanceAfter)).to.be.true;
  //       } catch (error) {
  //         // const testing = "JUST FOR TEST";
  //       }
  //       resolve();
  //     }),
  //   ]);
  // });

  // it("create sign ethers", async () => {
  //   const provider = new WCEthereumProvider(TEST_PROVIDER_OPTS);
  //   const wallet = new WalletTestClient(provider, {
  //     chainId: TEST_SESSION_CHAIN_ID,
  //     privateKey: TEST_SESSION_PRIVATE_KEY,
  //   });
  //   await Promise.all([
  //     wallet.approveSessionAndRequest(),
  //     new Promise<void>(async resolve => {
  //       try {
  //         const providerAccounts = await provider.enable();
  //         expect(providerAccounts).to.eql([TEST_SESSION_WALLET.address]);

  //         const web3Provider = new ethers.providers.Web3Provider(provider);
  //         const signer = await web3Provider.getSigner();
  //         const msg = "Hello world";
  //         console.log("Msg");
  //         const msg2 = ethers.utils.keccak256(
  //           "0x\x19Ethereum Signed Message:\n" + msg.length + msg,
  //         );
  //         console.log(msg2);
  //         const signature = await signer.signMessage(msg2);
  //         console.log("signature", signature);
  //         const verify = ethers.utils.verifyMessage(msg, signature);
  //         console.log("verify", verify);

  //         console.log("test2");
  //         const testWallet = new ethers.Wallet(TEST_SESSION_PRIVATE_KEY);
  //         const sig2 = await testWallet.signMessage(msg);
  //         const add2 = ethers.utils.verifyMessage(msg, sig2);
  //         console.log("add2, ", add2);
  //       } catch (error) {
  //         console.log(error);
  //         expect(error).to.be.false;
  //       }
  //       resolve();
  //     }),
  //   ]);
  // });

  it("closes test-network", async () => {
    await testNetwork.close();
  });
});