use crate::utils::seeds::STATE;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/* This argument will be used for both registering and updating the state account */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GenericStateInput {
    pub market: Pubkey,
    pub update_authority: Pubkey,
    pub treasury: Pubkey,
    pub purchase_threshold: u64,
    pub purchase_proportion: f32,
}

#[account]
pub struct State {
    pub market: Pubkey,
    pub update_authority: Pubkey,
    pub treasury: Pubkey,
    pub mint: Pubkey,
    pub purchase_threshold: u64,
    pub purchase_proportion: f32,
    pub bump: u8,
}

impl State {
    const SPACE: usize = 32 + 32 + 32 + 32 + 4 + 1 + 8 /* Discriminator */;
}

#[derive(Accounts)]
#[instruction(state_in: GenericStateInput)]
pub struct RegisterState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        space = State::SPACE,
        seeds = [STATE, state_in.market.key().as_ref()],
        payer = payer,
        bump
    )]
    pub state: Account<'info, State>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(state_in: GenericStateInput)]
pub struct UpdateState<'info> {
    #[account(
        mut,
        constraint = state.update_authority == payer.key(),
    )]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [STATE, state_in.market.key().as_ref()],
        bump = state.bump,
    )]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct AllocateYield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [STATE, state.market.key().as_ref()],
        bump = state.bump,
    )]
    pub state: Account<'info, State>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub holding_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
