import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaTokenProgram } from "../target/types/solana_token_program";
import { 
  TOKEN_PROGRAM_ID, 
  createAssociatedTokenAccountInstruction, 
  getAssociatedTokenAddress,
  createInitializeMintInstruction,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

describe("solana-token-program", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaTokenProgram as Program<SolanaTokenProgram>;
  
  const wallet = provider.wallet as anchor.Wallet;
  const mintAuthority = anchor.web3.Keypair.generate();
  const recipient = anchor.web3.Keypair.generate();
  
  let mint: anchor.web3.PublicKey;
  let walletTokenAccount: anchor.web3.PublicKey;
  let recipientTokenAccount: anchor.web3.PublicKey;
  const decimals = 8;
  
  it("Initialize a new token mint", async () => {
    // Create a new keypair for the mint account
    const mintKeypair = anchor.web3.Keypair.generate();
    mint = mintKeypair.publicKey;
    
    console.log("Mint address:", mint.toString());
    console.log("Mint authority:", mintAuthority.publicKey.toString());
    
    // Get the rent for the mint account
    const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);
    
    // Create the mint account and initialize it
    const tx = await program.methods
      .initializeMint(decimals)
      .accounts({
        mint: mint,
        payer: wallet.publicKey,
        mintAuthority: mintAuthority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([
        // Create the mint account
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
      ])
      .signers([mintKeypair])
      .rpc();
    
    console.log("Mint initialized with tx:", tx);
  });
  
  it("Create token accounts", async () => {
    // Create token accounts for wallet and recipient
    walletTokenAccount = await getAssociatedTokenAddress(
      mint,
      wallet.publicKey
    );
    
    recipientTokenAccount = await getAssociatedTokenAddress(
      mint,
      recipient.publicKey
    );
    
    // Create token accounts if they don't exist
    const tx = new anchor.web3.Transaction();
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        walletTokenAccount,
        wallet.publicKey,
        mint
      )
    );
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientTokenAccount,
        recipient.publicKey,
        mint
      )
    );
    
    await provider.sendAndConfirm(tx);
    console.log("Token accounts created");
  });
  
  it("Mint tokens to wallet", async () => {
    const amount = new anchor.BN(1000000000); // 10 tokens with 8 decimals
    
    const tx = await program.methods
      .mintTokens(amount)
      .accounts({
        mint: mint,
        tokenAccount: walletTokenAccount,
        mintAuthority: mintAuthority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([mintAuthority])
      .rpc();
    
    console.log("Tokens minted with tx:", tx);
  });
  
  it("Transfer tokens to recipient", async () => {
    const amount = new anchor.BN(500000000); // 5 tokens with 8 decimals
    
    const tx = await program.methods
      .transferTokens(amount)
      .accounts({
        from: walletTokenAccount,
        to: recipientTokenAccount,
        owner: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    
    console.log("Tokens transferred with tx:", tx);
  });
});