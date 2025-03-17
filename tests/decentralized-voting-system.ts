import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaVotingSystem } from "../target/types/solana_voting_system";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.SolanaVotingSystem as Program<SolanaVotingSystem>;
const admin = provider.wallet.payer;
const getCurrentTimestamp = (): number => Math.floor(Date.now() / 1000);

const fundAccount = async (keypair: Keypair, amount: number) => {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: keypair.publicKey,
      lamports: amount,
    })
  );
  return await provider.sendAndConfirm(tx, [admin]);
};

// 1. Test Initialize Voting System
describe("solana-voting-system - Initialize", () => {
  // Generate a new keypair for the voting system account
  const votingSystemKeypair = anchor.web3.Keypair.generate();

  it("Initializes the voting system", async () => {
    try {
      const tx = await program.methods
        .initializeVotingSystem()
        .accounts({
          votingSystem: votingSystemKeypair.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin, votingSystemKeypair])
        .rpc({ commitment: "confirmed" });

      console.log("Initialize tx:", tx);

      const votingSystemAccount = await program.account.votingSystem.fetch(votingSystemKeypair.publicKey);
      expect(votingSystemAccount.admin.toString()).to.equal(admin.publicKey.toString());
      expect(votingSystemAccount.proposalCount.toNumber()).to.equal(0);
    } catch (error) {
      console.error("Initialize error:", error);
      throw error;
    }
  });
});

describe("solana-voting-system - Create Proposal", () => {
  let votingSystemPDA: PublicKey;
  let proposalKeypair: Keypair;
  let proposalPDA: PublicKey;
  const startTime = getCurrentTimestamp() + 60;
  const endTime = getCurrentTimestamp() + 3600;

  before(async () => {
    // Use a keypair instead of a PDA
    const votingSystemKeypair = anchor.web3.Keypair.generate();
    votingSystemPDA = votingSystemKeypair.publicKey;
    
    // Initialize voting system first
    await program.methods
      .initializeVotingSystem()
      .accounts({
        votingSystem: votingSystemPDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, votingSystemKeypair]) // Add votingSystemKeypair as a signer
      .rpc({ commitment: "confirmed" });
  
    proposalKeypair = Keypair.generate();
    proposalPDA = proposalKeypair.publicKey;
  });

  it("Creates a proposal with multiple options", async () => {
    const tx = await program.methods
      .createProposal(
        "Test Proposal",
        "Test Description",
        ["Option1", "Option2", "Option3"],
        new anchor.BN(startTime),
        new anchor.BN(endTime)
      )
      .accounts({
        votingSystem: votingSystemPDA,
        proposal: proposalPDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, proposalKeypair])
      .rpc({ commitment: "confirmed" });

    console.log("Create proposal tx:", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.admin.toString()).to.equal(admin.publicKey.toString());
    expect(proposalAccount.title).to.equal("Test Proposal");
    expect(proposalAccount.options.length).to.equal(3);
  });

  it("Fails with less than two options", async () => {
    const invalidProposalKeypair = Keypair.generate();
    try {
      await program.methods
        .createProposal(
          "Invalid Proposal",
          "One option",
          ["Single"],
          new anchor.BN(startTime),
          new anchor.BN(endTime)
        )
        .accounts({
          votingSystem: votingSystemPDA,
          proposal: invalidProposalKeypair.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin, invalidProposalKeypair])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      const anchorError = anchor.AnchorError.parse(error.logs);
      expect(anchorError?.error.errorCode.code).to.equal("InsufficientOptions");
    }
  });

  it("Fails with invalid time range", async () => {
    const invalidProposalKeypair = Keypair.generate();
    try {
      await program.methods
        .createProposal(
          "Invalid Time",
          "Bad time range",
          ["Option1", "Option2"],
          new anchor.BN(endTime),
          new anchor.BN(startTime)
        )
        .accounts({
          votingSystem: votingSystemPDA,
          proposal: invalidProposalKeypair.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin, invalidProposalKeypair])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      const anchorError = anchor.AnchorError.parse(error.logs);
      expect(anchorError?.error.errorCode.code).to.equal("InvalidTimeRange");
    }
  });
});

// 3. Test Cast Vote
describe("solana-voting-system - Cast Vote", () => {
  const startTime = getCurrentTimestamp() + 60;
  const endTime = getCurrentTimestamp() + 3600;
  
  let votingSystemKeypair: Keypair;
  let proposalKeypair: Keypair;
  let voter1: Keypair;
  let voterRecordPDA1: PublicKey;
  
  before(async () => {
    // Create keypairs for the accounts
    votingSystemKeypair = anchor.web3.Keypair.generate();
    proposalKeypair = anchor.web3.Keypair.generate();
    voter1 = anchor.web3.Keypair.generate();
    
    // Initialize voting system
    await program.methods
      .initializeVotingSystem()
      .accounts({
        votingSystem: votingSystemKeypair.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, votingSystemKeypair]) // Include votingSystemKeypair as signer
      .rpc();
    
    // Create proposal
    await program.methods
      .createProposal(
        "Voting Test",
        "Test voting",
        ["Yes", "No"],
        new anchor.BN(startTime),
        new anchor.BN(endTime)
      )
      .accounts({
        votingSystem: votingSystemKeypair.publicKey,
        proposal: proposalKeypair.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, proposalKeypair]) // Include proposalKeypair as signer
      .rpc();
    
    // Fund test voter
    await fundAccount(voter1, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Find PDA for voter record
    [voterRecordPDA1] = PublicKey.findProgramAddressSync(
      [Buffer.from("voter_record"), proposalKeypair.publicKey.toBuffer(), voter1.publicKey.toBuffer()],
      program.programId
    );
    
    // Wait until voting period starts
    const currentTime = getCurrentTimestamp();
    const waitTime = (startTime - currentTime + 2) * 1000;
    if (waitTime > 0) {
      console.log(`Waiting ${waitTime/1000} seconds for voting to begin...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  });

  it("Casts a vote successfully", async () => {
    try {
      const tx = await program.methods
        .castVote(0) // Vote for "Yes" option
        .accounts({
          proposal: proposalKeypair.publicKey,
          voterRecord: voterRecordPDA1,
          voter: voter1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter1])
        .rpc({ commitment: "confirmed" });
      
      console.log("Vote tx:", tx);
      
      // Verify vote was recorded
      const proposalAccount = await program.account.proposal.fetch(proposalKeypair.publicKey);
      expect(proposalAccount.voteCounts[0].toNumber()).to.equal(1);
      expect(proposalAccount.totalVotes.toNumber()).to.equal(1);
    } catch (error) {
      console.error("Vote error:", error);
      throw error;
    }
  });

  it("Fails on second vote attempt from same user", async () => {
    try {
      await program.methods
        .castVote(1) // Try to vote for "No" option
        .accounts({
          proposal: proposalKeypair.publicKey,
          voterRecord: voterRecordPDA1,
          voter: voter1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter1])
        .rpc();
      
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      // Expect account already in use error
      expect(error.message).to.include("already in use");
    }
  });

  it("Fails with invalid option index", async () => {
    // Create a new voter for this test
    const voter2 = anchor.web3.Keypair.generate();
    await fundAccount(voter2, anchor.web3.LAMPORTS_PER_SOL);
    
    const [voterRecordPDA2] = PublicKey.findProgramAddressSync(
      [Buffer.from("voter_record"), proposalKeypair.publicKey.toBuffer(), voter2.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.methods
        .castVote(5) // Invalid option index
        .accounts({
          proposal: proposalKeypair.publicKey,
          voterRecord: voterRecordPDA2,
          voter: voter2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter2])
        .rpc();
      
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      const anchorError = anchor.AnchorError.parse(error.logs);
      expect(anchorError?.error.errorCode.code).to.equal("InvalidOptionIndex");
    }
  });
});

// 4. Test End Proposal
describe("solana-voting-system - End Proposal", () => {
  let votingSystemKeypair: Keypair;
  let proposalKeypair: Keypair;
  
  before(async () => {
    // Create keypairs for the accounts
    votingSystemKeypair = anchor.web3.Keypair.generate();
    proposalKeypair = anchor.web3.Keypair.generate();
    
    // Initialize voting system
    await program.methods
      .initializeVotingSystem()
      .accounts({
        votingSystem: votingSystemKeypair.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, votingSystemKeypair])
      .rpc();
    
    // Set the start time to 10 seconds in the future to ensure it's not in the past
    const startTime = getCurrentTimestamp() + 10;
    const endTime = getCurrentTimestamp() + 120; // End time 2 minutes after current time
    
    // Create proposal
    await program.methods
      .createProposal(
        "End Test",
        "Test ending",
        ["Yes", "No"],
        new anchor.BN(startTime),
        new anchor.BN(endTime)
      )
      .accounts({
        votingSystem: votingSystemKeypair.publicKey,
        proposal: proposalKeypair.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin, proposalKeypair])
      .rpc();

    // Wait until voting period starts (plus 2 seconds to be safe)
    const currentTime = getCurrentTimestamp();
    const waitTime = (startTime - currentTime + 2) * 1000;
    if (waitTime > 0) {
      console.log(`Waiting ${waitTime/1000} seconds for voting to begin...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  });

  it("Ends the proposal successfully", async () => {
    try {
      const tx = await program.methods
        .endProposal()
        .accounts({
          proposal: proposalKeypair.publicKey,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" });

      console.log("End proposal tx:", tx);

      const proposalAccount = await program.account.proposal.fetch(proposalKeypair.publicKey);
      expect(proposalAccount.isActive).to.be.false;
    } catch (error) {
      console.error("Error ending proposal:", error);
      throw error;
    }
  });

  it("Fails when non-admin tries to end", async () => {
    const nonAdmin = Keypair.generate();
    await fundAccount(nonAdmin, 2 * anchor.web3.LAMPORTS_PER_SOL);

    try {
      await program.methods
        .endProposal()
        .accounts({
          proposal: proposalKeypair.publicKey,
          admin: nonAdmin.publicKey,
        })
        .signers([nonAdmin])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      const anchorError = anchor.AnchorError.parse(error.logs);
      expect(anchorError?.error.errorCode.code).to.equal("NotAdmin");
    }
  });
});