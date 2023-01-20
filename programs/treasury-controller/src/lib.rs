#![allow(clippy::result_large_err)]
use crate::utils::errors::ErrorCode;
use crate::utils::state::*;
use crate::utils::token::*;
use anchor_lang::prelude::*;
mod utils;

declare_id!("stcGmoLCBsr2KSu2vvcSuqMiEZx36F32ySUtCXjab5B");

#[program]
pub mod treasury_controller {
    use super::*;

    pub fn register_state(ctx: Context<RegisterState>, state: GenericStateInput) -> Result<()> {
        let state_account = &mut ctx.accounts.state;
        state_account.mint = state.mint;
        state_account.update_authority = state.update_authority;
        state_account.treasury = state.treasury;
        state_account.purchase_threshold = state.purchase_threshold;
        state_account.purchase_proportion = state.purchase_proportion;
        state_account.price = state.price;
        state_account.holding_account = state.holding_account;
        state_account.holding_token_account = state.holding_token_account;
        state_account.index = state.index;
        state_account.bump = *ctx.bumps.get("state").unwrap();
        Ok(())
    }

    pub fn update_state(ctx: Context<UpdateState>, state: GenericStateInput) -> Result<()> {
        let state_account = &mut ctx.accounts.state;
        //state_account.market = state.market;
        state_account.update_authority = state.update_authority;
        state_account.treasury = state.treasury;
        state_account.purchase_threshold = state.purchase_threshold;
        state_account.purchase_proportion = state.purchase_proportion;
        state_account.holding_account = state.holding_account;
        state_account.holding_token_account = state.holding_token_account;
        state_account.price = state.price;
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price: f64) -> Result<()> {
        let state_account = &mut ctx.accounts.state;
        state_account.price = price;
        Ok(())
    }

    pub fn allocate_yield(ctx: Context<AllocateYield>) -> Result<()> {
        let mint_account = &ctx.accounts.mint;
        let state_account = &mut ctx.accounts.state;
        let treasury = &mut ctx.accounts.treasury;
        let token_program = &ctx.accounts.token_program;
        let holding_account = &mut ctx.accounts.holding_account;
        let holding_token_account = &mut ctx.accounts.holding_token_account;

        if state_account.treasury != treasury.key() {
            return Err(ErrorCode::InvalidTreasury.into());
        }

        if state_account.mint != mint_account.key() {
            return Err(ErrorCode::InvalidMint.into());
        }

        let available_amount = state_account.to_account_info().try_lamports()?
            - ctx.accounts.rent.minimum_balance(State::SPACE);

        if available_amount < state_account.purchase_threshold {
            return Err(ErrorCode::PurchaseThresholdExceeded.into());
        }

        // for now, we'll just assume the total amount is passed in as an argument
        // "Purchase_proportion" of the amount will go to purchasing
        let amount_used_for_token_purchase =
            (available_amount as f64 * state_account.purchase_proportion as f64) as u64;

        let amount_sent_to_treasury = available_amount
            .checked_sub(amount_used_for_token_purchase)
            .unwrap();

        // Price is token price in SOL
        // Amount is in lamports (9 dp)
        // We need to convert to the token amount in minor units
        // token amount = lamports / (10^(9-decimals)) * price
        // Note, this works even if decimals > 9
        let token_decimal_denominator = (10_f64).powi(9_i32 - mint_account.decimals as i32);
        let token_amount_to_buy_and_burn = (amount_used_for_token_purchase as f64
            / (token_decimal_denominator * state_account.price))
            as u64;

        msg!("Available amount: {}", available_amount);
        msg!(
            "Proportion used for purchase: {}",
            state_account.purchase_proportion
        );
        msg!("Purchase threshold: {}", state_account.purchase_threshold);
        msg!(
            "Amount used for token purchase: {}",
            amount_used_for_token_purchase
        );
        msg!("Buying and burning {} tokens", token_amount_to_buy_and_burn);
        msg!("Sending {} to treasury", amount_sent_to_treasury);

        burn(
            token_amount_to_buy_and_burn,
            state_account,
            mint_account,
            holding_token_account,
            token_program,
        )?;

        transfer_native(
            &state_account.to_account_info(),
            treasury,
            amount_sent_to_treasury,
        )?;
        transfer_native(
            &state_account.to_account_info(),
            holding_account,
            amount_used_for_token_purchase,
        )?;

        // update total sol spent
        state_account.total_spent += amount_used_for_token_purchase;

        Ok(())
    }
}
