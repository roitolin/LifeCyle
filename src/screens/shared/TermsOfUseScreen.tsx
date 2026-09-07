import LegalDocumentScreen, { type LegalDocumentSection } from './LegalDocumentScreen';

export const termsSections: readonly LegalDocumentSection[] = [
  {
    title: 'Agreement and eligibility',
    paragraphs: [
      'By creating an account, accepting these terms, or using LifeCycle, you agree to these Terms of Use and the Privacy Policy. If you do not agree, do not use the platform.',
      'You must be legally able to enter into this agreement and provide accurate information. If you use LifeCycle for another person or an organization, you confirm that you are authorized to do so.',
    ],
  },
  {
    title: 'Your account',
    paragraphs: [
      'You are responsible for keeping your login details secure, maintaining accurate account information, and promptly notifying LifeCycle support if you suspect unauthorized access. Activity performed through your account may be treated as activity authorized by you unless you report a security concern.',
      'Do not create a misleading identity, impersonate another person or funeral shop, share an account in a way that creates security risks, or attempt to bypass account protections.',
    ],
  },
  {
    title: 'LifeCycle’s role',
    paragraphs: [
      'LifeCycle helps families discover funeral-service providers, compare available offerings, submit service details, communicate with shops, and track requests, orders, and payments. Funeral shops are responsible for the services, products, prices, availability, representations, and fulfillment they offer.',
      'LifeCycle does not replace legal, financial, medical, grief-care, or other professional advice. Users should verify service scope, permits, schedules, prices, and other important details directly with the selected provider.',
    ],
  },
  {
    title: 'Service requests and arrangements',
    paragraphs: [
      'Provide complete and accurate arrangement details and review information before submitting it. A submitted request does not guarantee that a funeral shop will accept it or that a specific service, product, schedule, location, or price remains available.',
      'Families and providers are responsible for communicating changes, confirmations, cancellations, and fulfillment details through the available LifeCycle tools or another agreed channel.',
    ],
  },
  {
    title: 'Prices, payments, and refunds',
    paragraphs: [
      'Prices and fees displayed through LifeCycle are based on information provided for the selected offering and may be subject to confirmed service details. Review the amount and provider before authorizing payment.',
      'Payments may be processed by third-party providers and can be subject to their terms. Refunds, cancellations, adjustments, and disputes depend on the transaction, provider policy, applicable law, and the payment method used. Contact the provider and LifeCycle support promptly if a payment record appears incorrect.',
    ],
  },
  {
    title: 'Acceptable use',
    paragraphs: ['Use LifeCycle only for legitimate funeral-service coordination and related platform features. You agree not to:'],
    bulletPoints: [
      'Harass, threaten, discriminate against, deceive, or exploit another user or provider.',
      'Post unlawful, fraudulent, defamatory, harmful, or privacy-invasive content.',
      'Interfere with platform operation, probe security, introduce malicious code, scrape data without permission, or access another person’s account.',
      'Misrepresent services, prices, availability, identity, credentials, reviews, orders, requests, or payments.',
      'Use LifeCycle in a way that violates applicable law or another person’s rights.',
    ],
  },
  {
    title: 'Messages and submitted content',
    paragraphs: [
      'You remain responsible for information, photos, listings, service details, and messages you submit. You confirm that you have the right to provide that content and that it is accurate and appropriate for the intended transaction.',
      'You allow LifeCycle to store, display, transmit, and process submitted content as needed to operate, secure, and support the platform. Avoid sharing unnecessary sensitive information in conversations or public-facing content.',
    ],
  },
  {
    title: 'Safety, moderation, and account action',
    paragraphs: [
      'LifeCycle may review reported activity and may restrict content, features, transactions, or accounts when reasonably needed to protect users, investigate suspected fraud or abuse, enforce these terms, or comply with law. Users can block accounts and report concerns through available app features.',
      'LifeCycle is not an emergency service. For an immediate threat to safety, contact the appropriate local emergency authority.',
    ],
  },
  {
    title: 'Service availability and responsibility',
    paragraphs: [
      'We work to keep LifeCycle available and information useful, but the platform may experience interruptions, delays, errors, or changes. To the extent permitted by law, LifeCycle is provided without a guarantee that every feature, provider listing, or transaction will always be available, uninterrupted, or error-free.',
      'Nothing in these terms excludes rights or responsibilities that cannot legally be excluded. Each party remains responsible for its own acts and obligations under applicable law.',
    ],
  },
  {
    title: 'Changes and ending use',
    paragraphs: [
      'We may update these Terms of Use when LifeCycle features, risks, or legal requirements change. The effective date appears at the top of this screen, and important changes may also be communicated in the app or by email.',
      'You may stop using LifeCycle and request account deletion through available account controls. Provisions that reasonably need to continue—such as payment, dispute, security, content, and legal obligations—may remain effective after use ends.',
    ],
  },
  {
    title: 'Contact us',
    paragraphs: [
      'For questions about these Terms of Use, a service request, payment concern, or account issue, use Contact Support in the app or email support@lifecycle.ph.',
    ],
  },
];

export default function TermsOfUseScreen() {
  return (
    <LegalDocumentScreen
      title="Terms of Use"
      description="The rules and responsibilities that apply when you use LifeCycle to coordinate funeral services, communicate, order, or make payments."
      dateLabel="Effective date"
      date="April 2, 2026"
      icon="document-text-outline"
      sections={termsSections}
      closingNote="Open Contact Support from your profile or email support@lifecycle.ph."
    />
  );
}
