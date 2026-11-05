-- Social registration uses the same OAuth flow as returning social sign-in.
-- The previous hook blocked first-time Google and Facebook users globally.
drop function if exists private.require_registered_account_for_social_oauth(jsonb);
