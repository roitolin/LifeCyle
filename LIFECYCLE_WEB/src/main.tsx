import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { APP_ICON_URL } from '@/assets/appIconAssets'

document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', APP_ICON_URL)

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Application root element was not found.')
}

const root = createRoot(rootElement)

void import('./App.tsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    console.error('LifeCycle failed to start.', error)

    const message = error instanceof Error ? error.message : ''
    const isConfigurationError = message.includes('Missing required environment variable:')

    root.render(
      <main className={'startup-error'} role={'alert'}>
        <section className={'startup-error__card'}>
          <p className={'startup-error__eyebrow'}>LifeCycle</p>
          <h1>{isConfigurationError ? 'Deployment configuration needed' : 'We could not start the app'}</h1>
          <p>
            {isConfigurationError
              ? 'The website is missing required production configuration. Please contact the site administrator.'
              : 'Please refresh the page. If the problem continues, try again later.'}
          </p>
          <button type={'button'} onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </section>
      </main>,
    )
  })
