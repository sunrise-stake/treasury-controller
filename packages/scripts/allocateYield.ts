import { PublicKey } from "@solana/web3.js";
import { YieldControllerClient, setUpAnchor } from "../client/src";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";

const defaultStateAddress = "77aJfgRudbv9gFfjRQw3tuYzgnjoDgs9jorVTmK7cv73";
const stateAddress = new PublicKey(
  process.env.STATE_ADDRESS ?? defaultStateAddress
);

(async () => {
  const provider = setUpAnchor();
  const stateAccount = await YieldControllerClient.getYieldAccount(stateAddress);
  const holdingAccountTokenAddress = getAssociatedTokenAddressSync(
    stateAccount.mint,
    stateAccount.holdingAccount,
    true
  );
  // get sol holding accounts balance
  const solAccountBalance = await provider.connection.getBalance(stateAddress);
  // get token holding accounts balance
  const tokenAccountBalance = await provider.connection.getTokenAccountBalance(
    holdingAccountTokenAddress
  );
  console.log(
    "holding account token balance:",
    tokenAccountBalance.value.uiAmount
  );
  console.log("state account sol balance:", solAccountBalance);

  if (solAccountBalance === 0) {
    console.log("no tokens to allocate");
    return null;
  }

  if (
    tokenAccountBalance.value.amount < stateAccount.minimumPurchaseThreshold
  ) {
    console.log("not enough tokens to allocate");
    return null;
  }

  // get token account info
  const tokenAccountInfo = await getAccount(
    provider.connection,
    holdingAccountTokenAddress
  );

  if (!tokenAccountInfo.delegate) {
    console.log("token account delegate not set to state address");
    return null;
  }

  console.log("token account delegate:", tokenAccountInfo.delegate.toString());
  console.log("state address:", stateAddress.toString());

  if (tokenAccountInfo.delegate.toString() !== stateAddress.toString()) {
    console.log("token account delegate not set to state address");
    return null;
  }

  await YieldControllerClient.allocateYield(
    provider.publicKey,
    stateAddress
  );
})().catch(console.error);
