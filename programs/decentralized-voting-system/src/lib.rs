#![allow(unused_imports)]
#![allow(unexpected_cfgs)]
#![allow(unused_variables)]
use anchor_lang::prelude::*;

declare_id!("HdXmtvs3urKj2uNKGgGEUYDimP7N8xbfE8789JSxj1yy");

#[program]
pub mod solana_voting_system {
    use super::*;

    pub fn initialize_voting_system(ctx: Context<InitializeVotingSystem>) -> Result<()> {
        let voting_system = &mut ctx.accounts.voting_system;
        voting_system.admin = ctx.accounts.admin.key();
        voting_system.proposal_count = 0;
        
        msg!("Voting system initialized!");
        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>, 
        title: String, 
        description: String, 
        options: Vec<String>,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        require!(options.len() > 1, ErrorCode::InsufficientOptions);
        require!(start_time < end_time, ErrorCode::InvalidTimeRange);
        require!(start_time >= Clock::get()?.unix_timestamp, ErrorCode::PastStartTime);

        let voting_system = &mut ctx.accounts.voting_system;
        let proposal = &mut ctx.accounts.proposal;
        
        // Set proposal details
        proposal.admin = ctx.accounts.admin.key();
        proposal.title = title;
        proposal.description = description;
        proposal.options = options;
        proposal.vote_counts = vec![0; proposal.options.len()];
        proposal.start_time = start_time;
        proposal.end_time = end_time;
        proposal.is_active = true;
        proposal.total_votes = 0;
        proposal.index = voting_system.proposal_count;
        
        // Increment proposal count
        voting_system.proposal_count = voting_system.proposal_count.checked_add(1).unwrap();
        
        msg!("Proposal created successfully!");
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, option_index: u8) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let voter_record = &mut ctx.accounts.voter_record;
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        
        // Check if proposal is active and within time range
        require!(proposal.is_active, ErrorCode::ProposalInactive);
        require!(current_time >= proposal.start_time, ErrorCode::VotingNotStarted);
        require!(current_time <= proposal.end_time, ErrorCode::VotingEnded);
        
        // Check if option index is valid
        require!(
            (option_index as usize) < proposal.options.len(), 
            ErrorCode::InvalidOptionIndex
        );
        
        // Initialize voter record
        voter_record.voter = ctx.accounts.voter.key();
        voter_record.proposal = proposal.key();
        voter_record.option_index = option_index;
        voter_record.timestamp = current_time;
        
        // Update vote count for the selected option
        proposal.vote_counts[option_index as usize] = proposal.vote_counts[option_index as usize].checked_add(1).unwrap();
        
        // Increment total vote count
        proposal.total_votes = proposal.total_votes.checked_add(1).unwrap();
        
        msg!("Vote cast successfully!");
        Ok(())
    }

    pub fn end_proposal(ctx: Context<EndProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        
        // Only end active proposals
        require!(proposal.is_active, ErrorCode::ProposalInactive);
        
        // Mark proposal as inactive
        proposal.is_active = false;
        
        msg!("Proposal ended successfully!");
        Ok(())
    }
}

#[account]
pub struct VotingSystem {
    pub admin: Pubkey,         // Admin of the voting system
    pub proposal_count: u64,   // Counter to track the number of proposals
}

#[account]
pub struct Proposal {
    pub admin: Pubkey,         // Admin who created the proposal
    pub title: String,         // Title of the proposal
    pub description: String,   // Description of the proposal
    pub options: Vec<String>,  // Available voting options
    pub vote_counts: Vec<u64>, // Vote counts for each option
    pub start_time: i64,       // Voting start time (unix timestamp)
    pub end_time: i64,         // Voting end time (unix timestamp)
    pub is_active: bool,       // Whether the proposal is active
    pub total_votes: u64,      // Total number of votes cast
    pub index: u64,            // Index of the proposal
}

#[account]
pub struct VoterRecord {
    pub voter: Pubkey,         // Voter's public key
    pub proposal: Pubkey,      // Proposal public key
    pub option_index: u8,      // Index of the selected option
    pub timestamp: i64,        // Timestamp when vote was cast
}

#[derive(Accounts)]
pub struct InitializeVotingSystem<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8  // Discriminator + Pubkey + u64
    )]
    pub voting_system: Account<'info, VotingSystem>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(
        mut,
        constraint = voting_system.admin == admin.key() @ ErrorCode::NotAdmin
    )]
    pub voting_system: Account<'info, VotingSystem>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 4 + 100 + 4 + 500 + 4 + (4 * 50) + 4 + (8 * 50) + 8 + 8 + 1 + 8 + 8,
        // Discriminator + Pubkey + String(title) + String(description) + Vec<String>(options) + Vec<u64>(vote_counts) + i64 + i64 + bool + u64 + u64
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(option_index: u8)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    
    #[account(
        init,
        payer = voter,
        space = 8 + 32 + 32 + 1 + 8,  // Discriminator + Pubkey + Pubkey + u8 + i64
        seeds = [b"voter_record", proposal.key().as_ref(), voter.key().as_ref()],
        bump,
        constraint = proposal.is_active @ ErrorCode::ProposalInactive
    )]
    pub voter_record: Account<'info, VoterRecord>,
    
    #[account(mut)]
    pub voter: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndProposal<'info> {
    #[account(
        mut,
        constraint = proposal.admin == admin.key() @ ErrorCode::NotAdmin
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the admin can perform this action")]
    NotAdmin,
    
    #[msg("Proposal must have at least two options")]
    InsufficientOptions,
    
    #[msg("End time must be after start time")]
    InvalidTimeRange,
    
    #[msg("Start time cannot be in the past")]
    PastStartTime,
    
    #[msg("This proposal is no longer active")]
    ProposalInactive,
    
    #[msg("Voting period has not started yet")]
    VotingNotStarted,
    
    #[msg("Voting period has ended")]
    VotingEnded,
    
    #[msg("Invalid option index")]
    InvalidOptionIndex,
}