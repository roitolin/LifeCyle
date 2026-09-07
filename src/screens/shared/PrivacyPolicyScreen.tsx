import LegalDocumentScreen, { type LegalDocumentSection } from './LegalDocumentScreen';

const privacySections: readonly LegalDocumentSection[] = [
  {
    title: 'Information we collect',
    paragraphs: [
      'LifeCycle collects information you provide when you create or update an account, contact support, submit a service request, place an order, make a payment, or use funeral-shop tools.',
    ],
    bulletPoints: [
      'Account and contact details, such as your name, email address, phone number, birth date, profile photo, and saved address.',
      'Service-request, arrangement, order, delivery, payment-status, and conversation details you choose to submit.',
      'Funeral-shop, product, service, and order information provided through seller or provider tools.',
      'Technical and usage information, such as device type, app activity, login history, diagnostics, and pages or features used.',
    ],
  },
  {
    title: 'How we use your information',
    paragraphs: [
      'We use personal information to operate, secure, support, and improve LifeCycle. This includes verifying accounts, matching families with funeral-service providers, processing requests and orders, supporting payments, enabling conversations, delivering transaction updates, preventing misuse, and responding to support concerns.',
      'We may also use combined or de-identified information to understand how features are used and improve the reliability and accessibility of our services.',
    ],
  },
  {
    title: 'When information is shared',
    paragraphs: [
      'We share information only when needed to provide LifeCycle services, comply with legal obligations, protect users and the platform, or when you direct us to do so. We do not sell your personal information.',
    ],
    bulletPoints: [
      'Funeral shops receive the details needed to review and fulfill the service requests or orders you send to them.',
      'Payment and delivery partners receive the limited information needed to process a transaction or complete delivery.',
      'Technology and support providers may process information on our behalf to host, secure, maintain, or support LifeCycle.',
      'Information may be disclosed when reasonably required by law or to investigate fraud, abuse, safety concerns, or violations of our terms.',
    ],
  },
  {
    title: 'Payments and sensitive details',
    paragraphs: [
      'Payment transactions may be handled by third-party payment providers. LifeCycle uses transaction references, amounts, payment status, and related records to display and support your payments. Payment providers handle payment credentials according to their own privacy and security practices.',
      'Please avoid placing unnecessary identification, medical, financial, or other sensitive information in free-text service requests and messages.',
    ],
  },
  {
    title: 'Data security and retention',
    paragraphs: [
      'We take reasonable administrative and technical measures to protect information from unauthorized access, alteration, disclosure, or destruction. No internet transmission or storage method is completely secure, so absolute security cannot be guaranteed.',
      'We keep information for as long as needed to provide the service, maintain transaction and security records, resolve disputes, meet legal obligations, and enforce agreements. Retention periods can differ by record type and applicable requirements.',
    ],
  },
  {
    title: 'Your choices and account controls',
    paragraphs: [
      'You can review and update available profile details, manage notification preferences, review account activity, manage blocked accounts, and request account deletion from the app. You may also contact support to request help accessing or correcting your information, or to ask for a copy of your data.',
      'Some records may be retained after account deletion when required for transaction history, fraud prevention, dispute resolution, safety, or legal compliance.',
    ],
  },
  {
    title: 'Cookies, devices, and analytics',
    paragraphs: [
      'The LifeCycle website and app may use cookies, device storage, notifications, and similar technologies to keep you signed in, remember preferences, support security, measure performance, and understand feature usage. Browser, device, and notification settings can be used to control some of these technologies.',
    ],
  },
  {
    title: 'Policy updates',
    paragraphs: [
      'We may update this Privacy Policy as LifeCycle changes or as legal and operational requirements evolve. The updated date will appear at the top of this screen. When appropriate, we may also provide an in-app or email notice.',
    ],
  },
  {
    title: 'Contact us',
    paragraphs: [
      'If you have questions about this Privacy Policy, how your information is handled, or a privacy request, use Contact Support in the app or email support@lifecycle.ph.',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocumentScreen
      title="Privacy Policy"
      description="How LifeCycle collects, uses, shares, and protects information when families and funeral-service providers use our platform."
      dateLabel="Last updated"
      date="August 16, 2026"
      icon="shield-checkmark-outline"
      sections={privacySections}
      closingNote="Open Contact Support from your profile or email support@lifecycle.ph."
    />
  );
}
