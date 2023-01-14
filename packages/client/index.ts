import {
  Accounts,
  AnchorProvider,
  Program,
  utils,
} from "@project-serum/anchor";
import * as anchor from "@project-serum/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  TreasuryController,
  IDL,
} from "../../target/types/treasury_controller";
import { Connection } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "8Wbd1YbvX44jJHmBrythtrMWJiJH5u7NqT1EYspSYx78"
);

const setUpAnchor = (): anchor.AnchorProvider => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  return provider;
};

export const confirm = (connection: Connection) => async (txSig: string) =>
  connection.confirmTransaction({
    signature: txSig,
    ...(await connection.getLatestBlockhash()),
  });

export interface TreasuryControllerConfig {
  updateAuthority: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  purchaseThreshold: BN;
  purchaseProportion: number;
  bump: number;
}

export class TreasuryControllerClient {
  config: TreasuryControllerConfig | undefined;
  readonly program: Program<TreasuryController>;
  stateAddress: PublicKey | undefined;

  constructor(readonly provider: AnchorProvider, payer?: PublicKey) {
    this.program = new Program<TreasuryController>(IDL, PROGRAM_ID, provider);
  }

  private async init(stateAddress: PublicKey): Promise<void> {
    const state = await this.program.account.state.fetch(stateAddress);

    this.config = {
      updateAuthority: state.updateAuthority,
      treasury: state.treasury,
      mint: state.mint,
      purchaseThreshold: state.purchaseThreshold,
      purchaseProportion: state.purchaseProportion,
      bump: state.bump,
    };

    this.stateAddress = stateAddress;
  }

  /*
pub struct GenericStateInput {
    pub market: Pubkey,
    pub update_authority: Pubkey,
    pub treasury: Pubkey,
    pub purchase_threshold: u64,
    pub purchase_proportion: f32,
}
  */

  public static async register(
    updateAuthority: PublicKey,
    treasury: PublicKey,
    mint: PublicKey,
    holdingAccount: PublicKey,
    holdingTokenAccount: PublicKey,
    price: BN,
    purchaseProportion: number,
    purchaseThreshold: BN
  ): Promise<TreasuryControllerClient> {
    // find state address
    const [state, _bump] = await PublicKey.findProgramAddress(
      [Buffer.from("state"), mint.toBuffer()],
      PROGRAM_ID
    );
    let client = new TreasuryControllerClient(setUpAnchor());

    const accounts = {
      payer: client.provider.wallet.publicKey,
      state,
      mint,
      systemProgram: SystemProgram.programId,
    };

    await client.program.methods
      .registerState({
        mint,
        updateAuthority,
        treasury,
        holdingAccount,
        holdingTokenAccount,
        price,
        purchaseProportion,
        purchaseThreshold,
      })
      .accounts(accounts)
      .rpc()
      .then(() => {
        confirm(client.provider.connection);
      });

    await client.init(state);

    return client;
  }

  public static async update(
    state: PublicKey,
    updateAuthority: PublicKey,
    treasury: PublicKey,
    mint: PublicKey,
    holdingAccount: PublicKey,
    holdingTokenAccount: PublicKey,
    price: BN,
    purchaseProportion: number,
    purchaseThreshold: BN
  ): Promise<TreasuryControllerClient> {
    const client = new TreasuryControllerClient(setUpAnchor());

    const accounts = {
      payer: client.provider.publicKey,
      state,
    };

    await client.program.methods
      .updateState({
        mint,
        updateAuthority,
        treasury,
        holdingAccount,
        holdingTokenAccount,
        price,
        purchaseProportion,
        purchaseThreshold,
      })
      .accounts(accounts)
      .rpc()
      .then(confirm(client.provider.connection));

    await client.init(state);

    return client;
  }

  public static async allocateYield(
    payer: PublicKey,
    state: PublicKey,
    treasury: PublicKey,
    mint: PublicKey,
    holdingAccount: PublicKey,
    holdingTokenAccount: PublicKey,
    amount: BN
  ): Promise<TreasuryControllerClient> {
    const client = new TreasuryControllerClient(setUpAnchor());

    await client.program.methods.allocateYield(amount).accounts({
      payer,
      treasury,
      mint,
      holdingAccount,
      holdingTokenAccount,
    });

    return client;
  }
}