# LifeCycle

LifeCycle is a funeral service coordination system with:

- Mobile app (Expo + React Native)
- Web app (Vite + React)
- supabase backend (Auth + supabase)

It helps families, funeral shops, and admins coordinate funeral service arrangements, shop verification, product catalogs, service submissions, support, and moderation.

## Features

- User authentication (mobile/web)
- Funeral shop browsing and verification
- Funeral product catalog and cart flow
- Funeral service submission and tracking
- Admin dashboards, support inbox, feedback, and moderation tools

## Tech Stack

- Mobile: Expo, React Native, React Navigation, React Native Paper
- Web: React, Vite, React Router
- Backend/DB: supabase Authentication + Cloud supabase
- Language: TypeScript

## Project Structure

```text
lifecycle/
├─ src/                  # Mobile app source
├─ LIFECYCLE_WEB/        # Web app source
├─ config/               # Centralized project configs
├─ docs/                 # Guides, diagrams, references
├─ Security/             # Security documentation
├─ app.config.js         # Root Expo config entry
├─ supabase.json         # Root supabase entry
└─ package.json          # Mobile app scripts/deps
```

## Prerequisites

- Node.js 18+ recommended
- npm
- Expo CLI tools via `npx`
- Expo Go app for mobile device testing

## Setup

```bash
npm install
cd LIFECYCLE_WEB
npm install
cd ..
```

## Run

Mobile:

```bash
npx expo start
```

Web:

```bash
cd LIFECYCLE_WEB
npm run dev
```

## Scripts

- `npm run start` - Start Expo
- `npm run android` - Start Expo for Android
- `npm run ios` - Start Expo for iOS
- `npm run lint` - Lint mobile project
- `cd LIFECYCLE_WEB && npm run build` - Build web app

## Environment Notes

- Copy `.env.example` to `.env` and fill all supabase values before running.
- Supabase configuration is loaded from environment variables.
- All uploaded media is stored in Supabase Storage.

## Security Notes

Security documentation lives in [`Security/`](Security/README.md).
# LifeCyle
