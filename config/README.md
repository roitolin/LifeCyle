# Config Directory

This folder stores centralized configuration files for the root (mobile/supabase) project.

## Folders

- `expo/` - Expo app configuration source.
- `babel/` - Babel configuration source (module aliases/transforms).
- `eslint/` - ESLint rules/config source for mobile root project.
- `typescript/` - Base TypeScript configuration source.
- `supabase/` - supabase rules and index definitions.

## Root Entry Files

These root files are lightweight tool entry points that delegate here:

- `app.config.js` -> `config/expo/app.config.js`
- `babel.config.js` -> `config/babel/babel.config.js`
- `eslint.config.js` -> `config/eslint/eslint.config.js`
- `tsconfig.json` -> `config/typescript/tsconfig.base.json`
- `supabase.json` -> points to files under `config/supabase/`
