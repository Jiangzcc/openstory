import { localizeMeta } from '@/ui/i18n/head';
import { Trans, useTranslation } from 'react-i18next';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  CONTACT_EMAIL,
  PRIVACY_EMAIL,
  SITE_CONFIG,
} from '@/ui/marketing/constants';

const title = `Terms of Service — ${SITE_CONFIG.name}`;

export const Route = createFileRoute('/_app/terms')({
  component: TermsPage,
  head: ({ match }) => ({
    meta: localizeMeta(match.context.i18n, 'legal', [
      { title },
      { property: 'og:title', content: title },
      { property: 'og:url', content: `${SITE_CONFIG.url}/terms` },
      { name: 'twitter:title', content: title },
    ]),
  }),
});

function TermsPage() {
  const { t } = useTranslation('legal');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-heading text-4xl font-bold tracking-tight">
        {t('Terms of Service')}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('Effective date: 15 March 2026')}
      </p>
      <p className="mt-6 leading-relaxed text-muted-foreground">
        {t(
          'These Terms of Service (“Terms”) govern your access to and use of the {{value1}} platform, website, and services (collectively, the “Service”) operated by {{value2}} (“we”, “us”, or “our”). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, you may not use the Service.',
          { value1: SITE_CONFIG.name, value2: SITE_CONFIG.name }
        )}
      </p>

      {/* 1. The Service */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('1. The Service')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            '{{value1}} is an AI-powered video generation platform that enables users to create video content using artificial intelligence. The Service may include script analysis, scene generation, character extraction, image generation, video rendering, and related functionality.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'We use third-party AI models and infrastructure to power parts of the Service. The availability and capabilities of the Service may depend on these third-party providers. We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time. Where reasonably practicable, we will provide advance notice of material changes that affect your use of the Service.'
          )}
        </p>
      </section>

      {/* 2. Account Registration */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('2. Account Registration')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'To use certain features of the Service, you must create an account. You agree to provide accurate, current, and complete information during registration and to keep your account information up to date. You are solely responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us promptly if you become aware of any unauthorised use of your account.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'You must be at least 18 years of age to create an account. We may implement age verification measures and reserve the right to suspend or terminate accounts where we reasonably believe the account holder does not meet this age requirement. We reserve the right to suspend or terminate accounts that violate these Terms.'
          )}
        </p>
      </section>

      {/* 3. Credits, Payments & Billing */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('3. Credits, Payments & Billing')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'The Service operates on a credit-based billing model. Credits are required to use certain features, including video generation. Credits may be purchased through the Service at the prices displayed at the time of purchase.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Refund Policy')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Credits are generally non-refundable once purchased. We do not ordinarily offer refunds or exchanges for unused credits as a matter of commercial policy.'
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            <Trans
              ns="legal"
              i18nKey="Nothing in these Terms excludes, restricts, or modifies any rights or remedies you may have under the Australian Consumer Law (Schedule 2 of the <0>Competition and Consumer Act 2010</0> (Cth)) or any other applicable law that cannot be excluded by agreement. If the Service fails to meet a consumer guarantee, you may be entitled to a remedy, including a refund."
              components={[<em key="0" />]}
            />
          </p>
        </div>

        <h3 className="mt-6 text-lg font-semibold">{t('Credit Expiry')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Credits expire 12 months from the date of purchase. We will use reasonable efforts to notify you by email at least 30 days before your credits are due to expire. Any unused credits will be forfeited after the expiry period and cannot be reinstated or transferred. The credit expiry period is also displayed at the point of purchase.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Pricing Changes')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We reserve the right to change credit pricing at any time. Any price changes will not affect credits already purchased. We will provide at least 14 days’ notice of any pricing changes. Credits have no cash value and cannot be transferred, sold, or exchanged outside the platform.'
          )}
        </p>
      </section>

      {/* 4. Acceptable Use */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('4. Acceptable Use')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t('You agree not to use the Service to:')}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            {t(
              'Generate content that is unlawful, defamatory, obscene, harmful, or infringes the rights of any third party'
            )}
          </li>
          <li>
            {t(
              'Create deepfakes or misleading content that impersonates real individuals without their consent'
            )}
          </li>
          <li>
            {t(
              'Generate content that sexualises minors or facilitates the exploitation or abuse of children in any way'
            )}
          </li>
          <li>
            {t(
              'Upload, or generate from, any image, video, or voice recording of a real, identifiable person without that person’s written authorization covering AI generation. You are solely responsible for holding that authorization, and you must be able to produce it on request'
            )}
          </li>
          <li>
            {t(
              'Distribute spam, malware, or engage in any form of abuse against the Service or its users'
            )}
          </li>
          <li>
            {t(
              'Attempt to reverse engineer, decompile, or extract the underlying models, algorithms, or source code of the Service'
            )}
          </li>
          <li>
            {t(
              'Circumvent usage limits, access controls, or any technical restrictions of the Service'
            )}
          </li>
          <li>
            {t(
              'Use the Service in any manner that could damage, disable, or impair the Service'
            )}
          </li>
          <li>
            {t(
              'Use Generated Content in a way that violates applicable laws, including laws relating to misleading or deceptive conduct'
            )}
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'We reserve the right to suspend or terminate your access if we reasonably believe you have violated this section. Where practicable, we will notify you of the specific violation and provide an opportunity to remedy the breach before termination, except in cases of serious or repeated violations.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Reporting violations')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Anyone — including people who do not hold an account with us — may report content generated on the Service at <0>{{value1}}/report</0>, or by emailing <1>{{value2}}</1>. For instrumented generations we record the account, the model, and a hash of the prompt (not the prompt text) so reported content can be traced to its origin. That covers generated stills, motion clips, sheets, music, direct model-access assets, and sequence exports. User-uploaded reference photos are recorded as a rights warrant, not as generated content. Reports of child sexual abuse material and of non-consensual use of a person’s likeness are treated as urgent. Where a report is substantiated we remove the content and apply restrictions to the responsible account, up to and including closure."
            components={[
              <Link key="0" to="/report" className="underline" />,
              <a key="1" href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: SITE_CONFIG.url, value2: CONTACT_EMAIL }}
          />
        </p>
      </section>

      {/* 5. Intellectual Property */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('5. Intellectual Property')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">{t('Your Content')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'You retain ownership of any original content (scripts, images, prompts) that you submit to the Service (“Input Content”). By submitting Input Content, you grant us a limited, non-exclusive, worldwide licence to process, store, and use your Input Content solely for the purpose of providing the Service to you. We do not use your Input Content to train or improve our AI models unless you separately and explicitly consent to such use.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Generated Content')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Subject to these Terms, we assign to you all rights, if any, that we hold in the output generated by the Service from your Input Content (“Generated Content”). You acknowledge that the legal status of AI-generated content is evolving, and that some Generated Content may not attract copyright protection under Australian law or the laws of other jurisdictions. You are solely responsible for ensuring that your use of Generated Content complies with applicable laws and does not infringe any third-party rights.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'Because the AI models may produce similar outputs for similar inputs, we do not guarantee that Generated Content will be unique to you. We are not able to provide warranties of non-infringement in relation to Generated Content.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Our Platform')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'All rights, title, and interest in the Service — including its software, models, design, branding, and documentation — remain with {{value1}}. Nothing in these Terms grants you any right to use our trademarks, logos, or brand assets without our prior written consent.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
      </section>

      {/* 6. AI Transparency */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('6. AI Transparency')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'The Service uses artificial intelligence, including third-party AI models, to generate video content. You should be aware of the following:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>How AI is used:</0> When you submit Input Content (such as scripts or prompts), our system processes it using AI models to generate scenes, characters, images, and video. Automated processes are involved in analysing your input and producing Generated Content."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Limitations:</0> AI-generated content may contain inaccuracies, visual artefacts, biases, or unexpected results. The quality and accuracy of Generated Content may vary. You are responsible for reviewing all output before use or distribution."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Third-party providers:</0> We may use third-party AI models and cloud infrastructure to deliver the Service. These providers are subject to contractual obligations regarding data handling."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>No training on your content:</0> We do not use your Input Content or Generated Content to train or improve AI models unless you separately and explicitly opt in to such use."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'We are committed to responsible AI use in accordance with Australia’s AI Ethics Principles and will update these disclosures as the regulatory landscape evolves.'
          )}
        </p>
      </section>

      {/* 7. Privacy & Data Protection */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('7. Privacy & Data Protection')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Your use of the Service is also governed by our <0>Privacy Policy</0>, which describes how we collect, use, store, and disclose your personal information. By using the Service, you acknowledge that you have read and understood our Privacy Policy."
            components={[
              <Link
                key="0"
                to="/privacy"
                className="underline underline-offset-4 hover:text-foreground"
              />,
            ]}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Data Processing')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'In the course of providing the Service, we process the Input Content you submit (including scripts, images, and prompts) and generate video content from it. We retain your Input Content and Generated Content for as long as your account is active, or as otherwise described in our Privacy Policy. You may request deletion of your content by contacting us.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('International Data Transfers')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'The Service may involve the transfer of your data to servers and third-party providers located outside Australia. Where we transfer personal information overseas, we take reasonable steps to ensure that the recipient handles your information in accordance with the Australian Privacy Principles, and we implement appropriate contractual safeguards.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('For Users in the European Economic Area (EEA) or United Kingdom')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'If you are located in the EEA or UK, the following additional provisions apply:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Lawful basis:</0> We process your personal data on the basis of contractual necessity (to provide the Service), legitimate interests (to improve and secure the Service), and consent (where you have provided it)."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Your rights:</0> You have the right to access, rectify, erase, restrict processing of, and port your personal data. You also have the right to object to processing and to withdraw consent at any time. To exercise these rights, please contact us at <1>{{value1}}</1>."
              components={[
                <strong key="0" />,
                <a
                  key="1"
                  href={`mailto:${PRIVACY_EMAIL}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
              values={{ value1: PRIVACY_EMAIL }}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>International transfers:</0> Where we transfer your personal data outside the EEA or UK, we rely on appropriate safeguards such as Standard Contractual Clauses approved by the European Commission or UK authorities."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Supervisory authority:</0> You have the right to lodge a complaint with your local data protection supervisory authority."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
      </section>

      {/* 8. Disclaimers */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('8. Disclaimers')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'To the extent permitted by applicable law, the Service is provided on an “as is” and “as available” basis. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'AI-generated content may contain inaccuracies, artefacts, or unexpected results. You acknowledge that the quality and accuracy of Generated Content may vary, and you are responsible for reviewing all output before use.'
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            {t(
              'Nothing in this section excludes or limits any consumer guarantee under the Australian Consumer Law or any other statutory right or remedy that cannot be excluded or limited by agreement. Where the Australian Consumer Law applies, our liability for breach of a non-excludable consumer guarantee is limited, to the extent permitted by law, to re-supplying the services or paying the cost of having them re-supplied.'
            )}
          </p>
        </div>
      </section>

      {/* 9. Limitation of Liability */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('9. Limitation of Liability')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'To the maximum extent permitted by applicable law, {{value1}} and its officers, directors, employees, and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising out of or in connection with your use of the Service.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'Our total aggregate liability for any claims arising under these Terms shall not exceed the amount you paid to us in the twelve (12) months preceding the event giving rise to the claim.'
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            {t(
              'This limitation does not apply to liability that cannot be excluded or limited under the Australian Consumer Law, including liability for major failures as defined under the ACL. For major failures in the supply of services, you are entitled to cancel the contract and obtain a refund, or to seek compensation for the reduction in value of the services supplied.'
            )}
          </p>
        </div>
      </section>

      {/* 10. Indemnification */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('10. Indemnification')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'You agree to indemnify, defend, and hold harmless {{value1}} and its affiliates from any claims, losses, damages, liabilities, and expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Service in breach of these Terms; (b) your violation of any applicable law; or (c) your infringement of any third-party rights, including through your Input Content or use of Generated Content.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'This indemnification obligation does not apply to the extent that a claim arises from our own negligence, wilful misconduct, or breach of these Terms.'
          )}
        </p>
      </section>

      {/* 11. Termination */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('11. Termination')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Termination by {{value1}} for Cause', {
            value1: SITE_CONFIG.name,
          })}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We may suspend or terminate your access to the Service if you materially breach these Terms (including the Acceptable Use policy). Where practicable, we will provide you with notice and a reasonable opportunity to remedy the breach before termination, except in cases involving serious or repeated violations, illegal activity, or risk of harm to other users or the Service.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'Upon termination for cause, your right to use the Service ceases immediately. Any unused credits at the time of termination for cause will be forfeited.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Termination by {{value1}} without Cause', {
            value1: SITE_CONFIG.name,
          })}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We may discontinue providing the Service to you for any reason by giving you at least 30 days’ written notice. If we terminate your account without cause, we will provide a pro-rata refund or credit for any unused credits that were purchased and have not yet expired.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Termination by You')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="You may close your account at any time by contacting us at <0>{{value1}}</0>. Credits are non-refundable upon voluntary account closure under our commercial policy, but this does not affect any rights you may have under the Australian Consumer Law or other applicable laws."
            components={[
              <a
                key="0"
                href={`mailto:${CONTACT_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: CONTACT_EMAIL }}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Survival')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Sections of these Terms that by their nature should survive termination shall survive, including intellectual property, limitation of liability, indemnification, and dispute resolution.'
          )}
        </p>
      </section>

      {/* 12. Dispute Resolution */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('12. Dispute Resolution')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Informal Resolution')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="If you have a dispute or complaint about the Service, we encourage you to contact us first at <0>{{value1}}</0>. We will endeavour to resolve your concern within 14 business days."
            components={[
              <a
                key="0"
                href={`mailto:${CONTACT_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: CONTACT_EMAIL }}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Mediation')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'If we are unable to resolve a dispute informally, either party may refer the dispute to mediation administered by the Australian Disputes Centre (ADC) in Sydney, New South Wales, in accordance with the ADC Mediation Guidelines. The costs of mediation will be shared equally between the parties.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('Court Proceedings')}</h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'If the dispute is not resolved through mediation within 30 days of referral (or such longer period as the parties agree), either party may commence court proceedings. Nothing in this section prevents either party from seeking urgent interlocutory relief from a court of competent jurisdiction at any time.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'Nothing in this section limits your right to make a complaint to a relevant regulatory body, including the Australian Competition and Consumer Commission (ACCC), a state or territory consumer protection agency, or the Office of the Australian Information Commissioner (OAIC).'
          )}
        </p>
      </section>

      {/* 13. Changes to These Terms */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('13. Changes to These Terms')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'We may update these Terms from time to time. For minor or non-material changes, we will update the effective date and post the revised Terms on the Service.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'For material changes — including changes that affect pricing, credit expiry, your rights, or core Service functionality — we will:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            {t(
              'Notify you by email at least 30 days before the changes take effect'
            )}
          </li>
          <li>{t('Clearly identify the changes being made')}</li>
          <li>
            {t(
              'Give you the option to close your account before the changes take effect if you do not agree to them'
            )}
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'If you close your account because you do not accept a material change to these Terms, we will provide a pro-rata refund or credit for any unused credits that were purchased and have not yet expired.'
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'Your continued use of the Service after the effective date of any changes constitutes your acceptance of the revised Terms.'
          )}
        </p>
      </section>

      {/* 14. Governing Law */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('14. Governing Law')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'These Terms are governed by and construed in accordance with the laws of New South Wales, Australia, without regard to its conflict of law principles. Subject to the dispute resolution process in Section 12, any disputes arising under or in connection with these Terms shall be subject to the non-exclusive jurisdiction of the courts of New South Wales, Australia.'
          )}
        </p>
      </section>

      {/* 15. Australian Consumer Law */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('15. Australian Consumer Law')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Nothing in these Terms is intended to exclude, restrict, or modify any consumer guarantees or rights you may have under the Australian Consumer Law (Schedule 2 of the <0>Competition and Consumer Act 2010</0> (Cth)) or any other applicable law that cannot be excluded by agreement. To the extent that any provision of these Terms is inconsistent with any non-excludable statutory right, that provision shall be read down or severed to the extent of the inconsistency."
            components={[<em key="0" />]}
          />
        </p>
      </section>

      {/* 16. General */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('16. General')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>Severability.</0> If any provision of these Terms is found to be invalid or unenforceable, that provision will be enforced to the maximum extent permissible, and the remaining provisions will continue in full force and effect."
            components={[<strong key="0" />]}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>Entire agreement.</0> These Terms, together with the Privacy Policy, constitute the entire agreement between you and {{value1}} regarding the Service and supersede all prior agreements and understandings."
            components={[<strong key="0" />]}
            values={{ value1: SITE_CONFIG.name }}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>No waiver.</0> Our failure to enforce any right or provision of these Terms shall not be deemed a waiver of that right or provision."
            components={[<strong key="0" />]}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>Assignment.</0> You may not assign or transfer your rights or obligations under these Terms without our prior written consent. We may assign our rights and obligations under these Terms in connection with a merger, acquisition, or sale of assets, provided that the assignee agrees to be bound by these Terms."
            components={[<strong key="0" />]}
          />
        </p>
      </section>

      {/* 17. Contact */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('17. Contact')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t('If you have questions about these Terms, please contact us at:')}
        </p>
        <p className="mt-4 leading-relaxed">
          <strong>{t('General enquiries:')}</strong>{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2 leading-relaxed">
          <strong>{t('Privacy enquiries:')}</strong>{' '}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {PRIVACY_EMAIL}
          </a>
        </p>
      </section>
    </main>
  );
}
