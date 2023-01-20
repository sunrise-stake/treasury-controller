import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TreasuryController } from "../types/treasury_controller";
import BN from "bn.js";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, TreasuryControllerClient } from "../client";
import {
  Account,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
  approveChecked,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import testAuthority from "./fixtures/id.json";
const program = anchor.workspace
  .TreasuryController as Program<TreasuryController>;

export const expectAmount = (
  actualAmount: number | BN,
  expectedAmount: number | BN,
  tolerance = 0
) => {
  const actualAmountBN = new BN(actualAmount);
  const minExpected = new BN(expectedAmount).subn(tolerance);
  const maxExpected = new BN(expectedAmount).addn(tolerance);

  console.log(
    "Expecting",
    actualAmountBN.toString(),
    "to be at least",
    new BN(minExpected).toString(),
    "and at most",
    new BN(maxExpected).toString()
  );

  expect(actualAmountBN.gte(minExpected)).to.be.true;
  expect(actualAmountBN.lte(maxExpected)).to.be.true;
};

describe("treasury-controller", () => {
  let client: TreasuryControllerClient;
  const authority = Keypair.fromSecretKey(Uint8Array.from(testAuthority));
  const treasury = Keypair.generate();
  const holdingAccount = Keypair.generate();
  let holdingTokenAccount: Account;
  let mint: anchor.web3.PublicKey;
  let stateAddress: anchor.web3.PublicKey;
  let bump: number;

  const price = 0.05;
  const tokenDecimals = 5; // choose something other than 9 to ensure the maths are correct
  const tokensToMint = 1_000_000;
  const STATE_RENT = 2_324_640; // The amount kept in the state account for rent

  before(async () => {
    mint = await createMint(
      program.provider.connection,
      authority,
      authority.publicKey,
      null,
      tokenDecimals
    );
  });

  beforeEach(async () => {
    await program.provider.connection
      .requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL)
      .then(async (sig) => program.provider.connection.confirmTransaction(sig));

    holdingTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      authority,
      mint,
      holdingAccount.publicKey,
      true
    );

    [stateAddress, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("state"), mint.toBuffer(), Buffer.from([0])],
      PROGRAM_ID
    );
  });

  it("It can register a new controller state", async () => {
    client = await TreasuryControllerClient.register(
      authority.publicKey,
      treasury.publicKey,
      mint,
      holdingAccount.publicKey,
      holdingTokenAccount.address,
      price,
      0.9, // 90% goes to buying tokens
      new BN(LAMPORTS_PER_SOL), // Only purchase once we have accrued at least 1 sol,
      0
    );

    expect(client.stateAddress).not.to.be.null;

    const stateAddress = client.stateAddress as PublicKey;

    const state = await program.account.state.fetch(stateAddress);

    expect(state.updateAuthority.toBase58()).equal(
      client.provider.publicKey.toBase58()
    );
    expect(state.treasury.toBase58()).equal(treasury.publicKey.toBase58());
    expect(state.mint.toBase58()).equal(mint.toBase58());
    expect(state.purchaseThreshold.toNumber()).equal(LAMPORTS_PER_SOL);
    // TODO move away from floating point maths
    expectAmount(state.purchaseProportion, 0.9, 0.00000001);
    expect(state.bump).equal(bump);
  });
  it("Can allocate yield", async () => {
    // state account is PDA target for sunrise
    // give the state account 100 SOL
    await program.provider.connection
      .requestAirdrop(stateAddress, 100 * LAMPORTS_PER_SOL)
      .then(async (sig) => program.provider.connection.confirmTransaction(sig));

    // holding token account is created and delegate is set to the state account
    const holdingTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      authority,
      mint,
      holdingAccount.publicKey,
      true
    );

    // mint some tokens to the treasury token account and delegate to the state account
    // mint 1000000 tokens
    await mintToChecked(
      program.provider.connection,
      authority,
      mint,
      holdingTokenAccount.address,
      authority.publicKey,
      tokensToMint * 10 ** tokenDecimals,
      tokenDecimals
    );

    // set holding account delegate to state account
    await approveChecked(
      program.provider.connection,
      authority,
      mint,
      holdingTokenAccount.address,
      stateAddress,
      holdingAccount,
      tokensToMint * 10 ** tokenDecimals,
      tokenDecimals
    );

    // get token account info
    const holdingTokenAccountInfo = await getAccount(
      program.provider.connection,
      holdingTokenAccount.address
    );

    expect(holdingTokenAccountInfo?.delegate?.toBase58()).equal(
      stateAddress.toBase58()
    );

    // turn the crank
    console.log("turning the crank");
    client = await TreasuryControllerClient.allocateYield(
      authority.publicKey,
      stateAddress
    );

    const stateBalanceAfter = await program.provider.connection.getBalance(
      stateAddress
    );
    const treasuryBalanceAfter = await program.provider.connection.getBalance(
      treasury.publicKey
    );

    const holdingTokenAccountBalanceAfter =
      await program.provider.connection.getTokenAccountBalance(
        holdingTokenAccount.address
      );

    const holdingAccountBalanceAfter =
      await program.provider.connection.getBalance(holdingAccount.publicKey);

    const state = await program.account.state.fetch(stateAddress);

    // We expect:
    // 1. The state account to have 0 balance (less rent)
    // 2. The treasury account to have received 100 SOL * 0.1 = 10 SOL
    // 3. The SOL holding account to have received 100 SOL * 0.9 = 90 SOL
    // 4. The token holding account to have (90 / 0.05 = 1800) fewer tokens
    // 5. The state account to ahve been updated with the amount that was sent to the holding account

    expectAmount(stateBalanceAfter - STATE_RENT, 0);
    expectAmount(treasuryBalanceAfter, 10 * LAMPORTS_PER_SOL, 3000); // TODO fix floating point maths
    expectAmount(holdingAccountBalanceAfter, 90 * LAMPORTS_PER_SOL, 3000); // TODO fix floating point maths
    expectAmount(
      holdingTokenAccountBalanceAfter.value.uiAmount!,
      tokensToMint - 1800
    );
    expectAmount(state.totalSpent.toNumber(), holdingAccountBalanceAfter);
  });

  it("Can update controller price", async () => {
    const newPrice = 1.23;

    client = await TreasuryControllerClient.updatePrice(
      stateAddress,
      authority.publicKey,
      newPrice
    );

    const state = await program.account.state.fetch(stateAddress);
    expect(state.price).equal(newPrice);
  });
  it("Can update controller state", async () => {
    const newAuthority = Keypair.generate();
    const newTreasury = Keypair.generate();
    const newHoldingAccount = Keypair.generate();
    const newHoldingTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      authority,
      mint,
      newHoldingAccount.publicKey,
      true
    );

    client = await TreasuryControllerClient.updateController(
      stateAddress,
      newAuthority.publicKey,
      newTreasury.publicKey,
      mint,
      newHoldingAccount.publicKey,
      newHoldingTokenAccount.address,
      price,
      1,
      new BN(100),
      0
    );

    const state = await program.account.state.fetch(stateAddress);

    expect(state.updateAuthority.toBase58()).equal(
      newAuthority.publicKey.toBase58()
    );
    expect(state.treasury.toBase58()).equal(newTreasury.publicKey.toBase58());
    expect(state.mint.toBase58()).equal(mint.toBase58());
    expect(state.purchaseThreshold.toNumber()).equal(100);
    expect(state.purchaseProportion).equal(1);
    expect(state.bump).equal(bump);
  });
});
