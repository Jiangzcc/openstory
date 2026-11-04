import { localizeMeta } from '@/ui/i18n/head';
import { Trans, useTranslation } from 'react-i18next';
import { PRIVACY_EMAIL, SITE_CONFIG } from '@/ui/marketing/constants';
import { createFileRoute } from '@tanstack/react-router';

const title = `Privacy Policy — ${SITE_CONFIG.name}`;

export const Route = createFileRoute('/_app/privacy')({
  component: PrivacyPage,
  head: ({ match }) => ({
    meta: localizeMeta(match.context.i18n, 'legal', [
      { title },
      { property: 'og:title', content: title },
      { property: 'og:url', content: `${SITE_CONFIG.url}/privacy` },
      { name: 'twitter:title', content: title },
    ]),
  }),
});

function JurisdictionTag({ children }: { children?: React.ReactNode }) {
  return (
    <span className="mr-1 inline-block rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
      {children}
    </span>
  );
}

function PrivacyPage() {
  const { t } = useTranslation('legal');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t('Legal')}
      </p>
      <h1 className="mt-2 font-heading text-4xl font-bold tracking-tight">
        {t('Privacy Policy')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('Effective 16 March 2026 · Last updated 16 March 2026')}
      </p>

      {/* 1. Introduction */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('1. Introduction')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            '{{value1}} (“we”, “us”, “our”) is an AI-powered video generation platform that transforms film scripts into complete video productions. We are committed to protecting the privacy of individuals who use our platform, visit our website, or otherwise interact with us.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'This Privacy Policy explains how we collect, use, disclose, store, and protect personal information in accordance with:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="The <0>Privacy Act 1988 (Cth)</0>, the <1>Australian Privacy Principles</1> (“APPs”), and the <2>Privacy and Other Legislation Amendment Act 2024</2> (Australia)"
              components={[
                <strong key="0" />,
                <strong key="1" />,
                <strong key="2" />,
              ]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="The <0>General Data Protection Regulation (EU) 2016/679</0> (“GDPR”), where we offer services to individuals in the European Economic Area (“EEA”) or United Kingdom"
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="Applicable <0>US state privacy laws</0>, including the California Consumer Privacy Act as amended by the CPRA (“CCPA”), to the extent their thresholds are met"
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'Where provisions apply only to users in a particular jurisdiction, we indicate this with a label.'
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            <Trans
              ns="legal"
              i18nKey="<0>Entity:</0> {{value1}} is a registered trading name operated by a sole trader in New South Wales, Australia."
              components={[<strong key="0" />]}
              values={{ value1: SITE_CONFIG.name }}
            />
          </p>
          <p className="mt-1">
            <strong>{t('Contact:')}</strong>{' '}
            <a
              href={`mailto:${PRIVACY_EMAIL}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {PRIVACY_EMAIL}
            </a>
          </p>
          <p className="mt-1">
            <strong>{t('Website:')}</strong>{' '}
            <a
              href={SITE_CONFIG.url}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {SITE_CONFIG.url}
            </a>
          </p>
        </div>
      </section>

      {/* 2. Scope */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('2. Scope')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'This Privacy Policy applies to personal information collected through:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="The {{value1}} platform and web application (<0>{{value2}}</0>)"
              components={[
                <a
                  key="0"
                  href={SITE_CONFIG.url}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
              values={{ value1: SITE_CONFIG.name, value2: SITE_CONFIG.url }}
            />
          </li>
          <li>{t('Our application programming interfaces (APIs)')}</li>
          <li>
            {t('Communications with us, including email and support channels')}
          </li>
          <li>{t('Any related services, tools, or features we provide')}</li>
        </ul>
      </section>

      {/* 3. What Is Personal Information */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('3. What Is Personal Information')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Under the Australian Privacy Act, <0>personal information</0> means information or an opinion about an identified individual, or an individual who is reasonably identifiable, whether the information or opinion is true or not and whether it is recorded in a material form or not. Following the 2024 amendments, this definition encompasses technical identifiers such as IP addresses where they can be used to reasonably identify an individual."
            components={[<strong key="0" />]}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> Under the GDPR, <1>personal data</1> means any information relating to an identified or identifiable natural person. An identifiable person is one who can be identified, directly or indirectly, by reference to an identifier such as a name, identification number, location data, or online identifier."
            components={[<JurisdictionTag key="0" />, <strong key="1" />]}
          />
        </p>
      </section>

      {/* 4. Information We Collect */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('4. Information We Collect')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">
          {t('4.1 Information You Provide Directly')}
        </h3>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Account information:</0> name, email address, password (stored in hashed form), and account preferences."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Payment information:</0> billing address and payment details. Payment card information is processed by our third-party payment processor and is not stored on our servers."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Content and scripts:</0> film scripts, scene descriptions, character descriptions, creative briefs, and other content you upload or input for video generation."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Communications:</0> messages you send to us via email, support requests, or feedback forms."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          {t('4.2 Information Collected Automatically')}
        </h3>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Usage data:</0> features used, actions taken, generation history, timestamps, and session duration."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Device and technical data:</0> IP address, browser type and version, operating system, device identifiers, and screen resolution."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Log data:</0> server logs recording access times, pages viewed, referring URLs, and error reports."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Cookies and similar technologies:</0> we use cookies, local storage, and similar tracking technologies to operate and improve the platform (see Section 17)."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          {t('4.3 Information from Third Parties')}
        </h3>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Authentication providers:</0> if you sign in using a third-party service (e.g., Google), we receive your name, email, and profile picture as authorised by you."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Analytics providers:</0> aggregated and pseudonymised usage analytics."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
      </section>

      {/* 5. How We Use Your Information */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('5. How We Use Your Information')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'We collect and use personal information only for purposes that are reasonably necessary for, or directly related to, our functions and activities (APP 6). These purposes include:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Providing and operating the platform:</0> processing your scripts, generating video content, managing your account, and delivering our services."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>AI processing:</0> analysing scripts to identify scenes, characters, and visual elements, and generating images, video, and motion content using AI models (see Section 7)."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Improving our services:</0> analysing usage patterns, diagnosing technical issues, developing new features, and enhancing platform performance."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Communications:</0> sending service-related notices, responding to inquiries, and providing customer support."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Security and fraud prevention:</0> detecting, preventing, and addressing security incidents, fraud, and abuse."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Legal compliance:</0> complying with applicable laws, regulations, legal processes, or enforceable governmental requests."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Marketing (with consent):</0> sending promotional communications where you have opted in. You may opt out at any time."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
      </section>

      {/* 6. Lawful Basis for Processing (GDPR) */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('6. Lawful Basis for Processing (GDPR)')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> Under the GDPR, we must have a lawful basis for each processing activity involving personal data of individuals in the EEA or UK."
            components={[<JurisdictionTag key="0" />]}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('6.1 Performance of a Contract (Article 6(1)(b))')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Processing necessary to perform our contract with you: creating and managing your account, processing scripts and generating video content, processing payments, and providing customer support.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('6.2 Legitimate Interests (Article 6(1)(f))')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Processing necessary for our legitimate interests where not overridden by your rights: improving and optimising the platform, ensuring security and preventing fraud, enforcing our terms of service, and administrative purposes. You have the right to object to this processing (see Section 13).'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('6.3 Consent (Article 6(1)(a))')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Where we rely on your consent: sending marketing communications and placing non-essential cookies. You may withdraw consent at any time without affecting the lawfulness of prior processing.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('6.4 Legal Obligation (Article 6(1)(c))')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Processing necessary to comply with legal obligations: tax reporting, responding to lawful government requests, and data breach notification requirements.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('6.5 Data Protection Impact Assessment')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We have conducted a Data Protection Impact Assessment (DPIA) for our use of AI models to process user-submitted content, as required under GDPR Article 35 for processing that uses innovative technologies and may result in high risk to data subjects. A summary is available on request.'
          )}
        </p>
      </section>

      {/* 7. AI Processing & Transparency */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('7. AI Processing & Transparency')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            '{{value1}} uses artificial intelligence and machine learning systems to analyse scripts, generate visual content, and produce video outputs.',
            { value1: SITE_CONFIG.name }
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('7.1 How We Use AI')}</h3>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            {t(
              'Large language models (LLMs) analyse your script content, identify scenes, generate character descriptions, and create visual prompts.'
            )}
          </li>
          <li>
            {t(
              'Image generation models create character sheets, scene images, and visual assets.'
            )}
          </li>
          <li>
            {t(
              'Video generation models produce motion content and assemble final video outputs.'
            )}
          </li>
          <li>
            {t(
              'You retain the ability to review, modify, and regenerate any AI-produced output.'
            )}
          </li>
          <li>
            {t(
              'No automated process is used to deny you access to our services or to make decisions that produce legal effects concerning you.'
            )}
          </li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          {t('7.2 Third-Party AI Providers')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Your content is processed by the following categories of third-party AI service providers. We maintain Data Processing Agreements (DPAs) with each provider.'
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            <Trans
              ns="legal"
              i18nKey="<0>Large Language Models:</0> Anthropic (Claude) — script analysis, scene breakdown, and prompt generation. Processed via API under zero-data-retention terms; not used for model training."
              components={[<strong key="0" />]}
            />
          </p>
          <p className="mt-2">
            <Trans
              ns="legal"
              i18nKey="<0>Image Generation:</0> Provider(s) for character sheet and scene image generation. Processed via API under DPAs; not used for model training."
              components={[<strong key="0" />]}
            />
          </p>
          <p className="mt-2">
            <Trans
              ns="legal"
              i18nKey="<0>Video Generation:</0> Provider(s) for motion content generation. Processed via API under DPAs; not used for model training."
              components={[<strong key="0" />]}
            />
          </p>
        </div>
        <p className="mt-4 leading-relaxed">
          {t(
            'Each DPA includes purpose limitation, data retention limits, sub-processor notification, breach notification, audit rights, and deletion on termination. We will update this section as provider relationships change.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('7.3 Training Data')}</h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>We do not use your scripts, content, or personal information to train AI models.</0> Your content is processed solely for generating outputs you have requested. Our third-party AI providers operate under API terms that exclude customer data from model training."
            components={[<strong key="0" />]}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('7.4 AI-Generated Content Labeling')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We are implementing measures to ensure AI-generated video content is marked in a machine-readable format as AI-generated (using C2PA metadata standards where technically feasible), identifiable as artificially generated content, and labeled visibly where required by applicable law. These measures are being implemented ahead of the EU AI Act Article 50 transparency deadline of 2 August 2026.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('7.5 Australian ADM Transparency')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'In compliance with the automated decision-making transparency requirements under the Privacy and Other Legislation Amendment Act 2024 (effective 10 December 2026), our AI systems process account identifiers, script content, and usage data. These automated processes determine scene breakdowns, character generation, visual prompts, and video assembly. They are core to service delivery and do not make decisions that could reasonably be expected to significantly affect your rights or interests beyond generating creative content based on your inputs.'
          )}
        </p>
      </section>

      {/* 8. Disclosure of Personal Information */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('8. Disclosure of Personal Information')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t('We may disclose personal information to:')}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Service providers:</0> cloud hosting, payment processors, email delivery, and analytics providers who process data on our behalf under contractual obligations."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>AI model providers:</0> third-party AI services (see Section 7.2)."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Professional advisors:</0> lawyers, accountants, and auditors where necessary."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Law enforcement and regulators:</0> where required by law, court order, or regulatory obligation."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Business transfers:</0> in connection with a sale or transfer of the business."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>We do not sell your personal information.</0> We do not share personal information for cross-context behavioural advertising."
            components={[<strong key="0" />]}
          />
        </p>
      </section>

      {/* 9. International Data Transfers */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('9. International Data Transfers')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            '{{value1}} is based in Australia and operates cloud infrastructure and third-party services in multiple countries. Your personal information may be transferred to and processed in:',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            <Trans
              ns="legal"
              i18nKey="<0>Australia:</0> Primary business operations."
              components={[<strong key="0" />]}
            />
          </p>
          <p className="mt-1">
            <Trans
              ns="legal"
              i18nKey="<0>United States:</0> Cloud infrastructure, AI model providers, payment processing, and analytics."
              components={[<strong key="0" />]}
            />
          </p>
          <p className="mt-1">
            <Trans
              ns="legal"
              i18nKey="<0>Other countries:</0> Where our service providers maintain data centres."
              components={[<strong key="0" />]}
            />
          </p>
        </div>

        <h3 className="mt-6 text-lg font-semibold">
          {t('9.1 Safeguards for Australian Users (APP 8)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Before disclosing personal information to an overseas recipient, we take reasonable steps to ensure the recipient handles the information in accordance with the APPs, through contractual arrangements and data processing agreements.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('9.2 Safeguards for EEA/UK Users')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> Australia does not have an EU adequacy decision. For transfers of personal data from the EEA or UK, we rely on:"
            components={[<JurisdictionTag key="0" />]}
          />
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Standard Contractual Clauses (SCCs):</0> European Commission SCCs (module 2: controller-to-processor) with service providers and AI model providers, supplemented by additional technical and organisational measures where necessary."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>EU-US Data Privacy Framework:</0> Where our US-based providers are certified under the Framework."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Transfer Impact Assessments:</0> We conduct TIAs to evaluate the legal framework in each destination country and implement supplementary measures where risks are identified."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="You may request a copy of the relevant transfer safeguards by contacting <0>{{value1}}</0>."
            components={[
              <a
                key="0"
                href={`mailto:${PRIVACY_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: PRIVACY_EMAIL }}
          />
        </p>
      </section>

      {/* 10. Data Retention */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('10. Data Retention')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Account information:</0> retained for the duration of your account and 12 months after deletion, unless a longer period is required by law."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Generated content:</0> retained while your account is active. Deleted within 90 days of account deletion."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Usage and log data:</0> retained for up to 24 months, then aggregated or deleted."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Payment records:</0> retained for 7 years as required by Australian taxation law."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Support communications:</0> retained for 24 months after resolution."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>AI provider processing:</0> providers do not retain input or output data beyond the API request (zero-data-retention)."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'When personal information is no longer needed, we take reasonable steps to destroy or de-identify it (APP 11.2).'
          )}
        </p>
      </section>

      {/* 11. Data Security */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('11. Data Security')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'We take reasonable technical and organisational measures to protect personal information (APP 11.1; GDPR Article 32), including:'
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>{t('Encryption of data in transit (TLS 1.2+) and at rest')}</li>
          <li>{t('Access controls and authentication mechanisms')}</li>
          <li>{t('Regular security assessments and monitoring')}</li>
          <li>{t('Contractor and staff confidentiality obligations')}</li>
          <li>
            {t('Incident response and data breach notification procedures')}
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'No method of electronic storage or transmission is completely secure. While we strive to protect your personal information, we cannot guarantee its absolute security.'
          )}
        </p>
      </section>

      {/* 12. Your Rights — Australia */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('12. Your Rights — Australia')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">
          {t('12.1 Access (APP 12)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'You may request access to personal information we hold about you. We will respond within 30 days.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('12.2 Correction (APP 13)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'You may request correction of inaccurate, incomplete, out-of-date, irrelevant, or misleading personal information. We will respond within 30 days.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('12.3 Anonymity and Pseudonymity (APP 2)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Where practicable, you may use a pseudonym or choose not to identify yourself. However, this may limit access to some platform features.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('12.4 Direct Marketing (APP 7)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="You may opt out of marketing communications at any time via the unsubscribe link or by contacting <0>{{value1}}</0>."
            components={[
              <a
                key="0"
                href={`mailto:${PRIVACY_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: PRIVACY_EMAIL }}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('12.5 Direct Right of Action')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'Under the Privacy and Other Legislation Amendment Act 2024, individuals may seek damages directly from APP entities through the Federal Court for serious or repeated interferences with privacy, without first needing to lodge a complaint with the OAIC.'
          )}
        </p>
      </section>

      {/* 13. Your Rights — EU/EEA (GDPR) */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('13. Your Rights — EU/EEA (GDPR)')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> If you are located in the EEA or UK, you have the following rights. Contact <1>{{value1}}</1> to exercise them. We will respond within 30 days."
            components={[
              <JurisdictionTag key="0" />,
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
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Access (Article 15):</0> Obtain confirmation of processing and a copy of your personal data."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Rectification (Article 16):</0> Correct inaccurate or incomplete data."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Erasure (Article 17):</0> Request deletion where data is no longer necessary, you withdraw consent, you object to processing, or data was unlawfully processed."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Restriction (Article 18):</0> Request restricted processing while accuracy is verified, if processing is unlawful, or pending an objection assessment."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Portability (Article 20):</0> Receive your data in a structured, machine-readable format and transmit it to another controller."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Object (Article 21):</0> Object to processing based on legitimate interests. You have an absolute right to object to direct marketing."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Automated decisions (Article 22):</0> Not be subject to solely automated decisions producing legal or similarly significant effects. Our AI processing generates creative content and does not produce such effects."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="You may lodge a complaint with your local supervisory authority. A full list is at <0>edpb.europa.eu</0>."
            components={[
              <a
                key="0"
                href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('EU Representative')}</h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Under GDPR Article 27, non-EU controllers must appoint a representative in the EU. We will appoint an EU representative and update this section with their contact details as we scale our services to EEA users. In the meantime, all privacy enquiries can be directed to <0>{{value1}}</0>."
            components={[
              <a
                key="0"
                href={`mailto:${PRIVACY_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: PRIVACY_EMAIL }}
          />
        </p>
      </section>

      {/* 14. Your Rights — United States */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('14. Your Rights — United States')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>US</0> Several US states have enacted comprehensive privacy laws, including California (CCPA/CPRA), Texas (TDPSA), Colorado, Connecticut, Virginia, and others. The applicability of these laws depends on whether specific thresholds are met (e.g., revenue, volume of consumers, or data sales). As {{value1}} grows, we are committed to complying with all applicable US state privacy requirements. This section describes the rights we will honour for US users."
            components={[<JurisdictionTag key="0" />]}
            values={{ value1: SITE_CONFIG.name }}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('14.1 Your Rights')}</h3>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Right to Know / Access:</0> Know what personal information we collect, use, and disclose, and request a copy."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Right to Delete:</0> Request deletion of personal information, subject to legal exceptions."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Right to Correct:</0> Request correction of inaccurate personal information."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Right to Opt Out of Sale or Sharing:</0> We do not sell personal information or share it for cross-context behavioural advertising."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Right to Non-Discrimination:</0> We will not discriminate against you for exercising your rights."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          {t('14.2 How to Exercise Your Rights')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="Email <0>{{value1}}</0> with your request. We will verify your identity and respond within 45 days."
            components={[
              <a
                key="0"
                href={`mailto:${PRIVACY_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: PRIVACY_EMAIL }}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('14.3 Global Privacy Control')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We honour the Global Privacy Control (GPC) signal. When we detect a GPC signal from your browser, we treat it as a valid opt-out request for the sale or sharing of personal information.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('14.4 California Disclosures')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'If and when CCPA thresholds are met, we will maintain a full set of California-specific disclosures including categories of personal information collected and disclosed, a “Do Not Sell or Share” mechanism, and CCPA-specific metrics. We do not currently meet CCPA applicability thresholds.'
          )}
        </p>
      </section>

      {/* 15. Statutory Tort for Serious Invasions of Privacy */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('15. Statutory Tort for Serious Invasions of Privacy')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'From 10 June 2025, Australia’s statutory tort for serious invasions of privacy (Schedule 2 of the Privacy and Other Legislation Amendment Act 2024) provides individuals with a personal right of action where their privacy has been seriously invaded through intrusion upon seclusion or misuse of personal information. This applies regardless of entity turnover. We have implemented measures to prevent any conduct that could constitute a serious invasion of privacy.'
          )}
        </p>
      </section>

      {/* 16. Children's Privacy */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('16. Children’s Privacy')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            '{{value1}} is not directed at children. We do not knowingly collect personal information from children without appropriate consent.',
            { value1: SITE_CONFIG.name }
          )}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Australia:</0> Users must be at least 18 years of age, or have parental consent, to create an account. We are monitoring Australia’s Children’s Online Privacy Code (to be registered by 10 December 2026)."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>EU:</0> Users must meet the minimum age for consent in their Member State (13–16 depending on country). Below that age, consent must come from a parent or guardian."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>US:</0> We comply with COPPA and do not knowingly collect personal information from children under 13. The FTC’s amended COPPA Rule (compliance deadline 22 April 2026) broadens the definition of personal information and strengthens protections."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          {t(
            'If we become aware that we have collected personal information from a child without appropriate consent, we will delete that information promptly.'
          )}
        </p>
      </section>

      {/* 17. Cookies & Tracking Technologies */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('17. Cookies & Tracking Technologies')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Strictly necessary:</0> essential for authentication and security."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Functional:</0> remembering your preferences and settings."
              components={[<strong key="0" />]}
            />
          </li>
          <li>
            <Trans
              ns="legal"
              i18nKey="<0>Analytics:</0> understanding how users interact with the platform."
              components={[<strong key="0" />]}
            />
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> For EEA/UK users, non-essential cookies are only placed with your prior consent. You can manage preferences through the cookie banner or your account settings."
            components={[<JurisdictionTag key="0" />]}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          {t(
            'You can manage cookies through your browser settings. We honour the Global Privacy Control signal as a cookie opt-out where required by law.'
          )}
        </p>
      </section>

      {/* 18. Notifiable Data Breaches */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('18. Notifiable Data Breaches')}
        </h2>

        <h3 className="mt-6 text-lg font-semibold">
          {t('Australia (Part IIIC, Privacy Act)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          {t(
            'We will assess suspected breaches within 30 days and notify the OAIC and affected individuals as soon as practicable if the breach is likely to result in serious harm.'
          )}
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          {t('EU/EEA (GDPR Articles 33–34)')}
        </h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>GDPR</0> We will notify the relevant supervisory authority within 72 hours. Where a breach poses high risk to individuals, we will also notify affected data subjects without undue delay."
            components={[<JurisdictionTag key="0" />]}
          />
        </p>

        <h3 className="mt-6 text-lg font-semibold">{t('United States')}</h3>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="<0>US</0> We will comply with applicable state data breach notification laws."
            components={[<JurisdictionTag key="0" />]}
          />
        </p>
      </section>

      {/* 19. Complaints */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('19. Complaints')}
        </h2>
        <p className="mt-4 leading-relaxed">
          <Trans
            ns="legal"
            i18nKey="If you believe we have breached applicable privacy laws, contact <0>{{value1}}</0>. We will acknowledge within 5 business days, investigate and respond within 30 days."
            components={[
              <a
                key="0"
                href={`mailto:${PRIVACY_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: PRIVACY_EMAIL }}
          />
        </p>
        <p className="mt-4 leading-relaxed">
          {t('If unsatisfied, you may escalate to:')}
        </p>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p>
            <Trans
              ns="legal"
              i18nKey="<0>Australia:</0> Office of the Australian Information Commissioner (OAIC) — <1>www.oaic.gov.au</1> · 1300 363 992 · GPO Box 5218, Sydney NSW 2001"
              components={[
                <strong key="0" />,
                <a
                  key="1"
                  href="https://www.oaic.gov.au"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
            />
          </p>
          <p className="mt-2">
            <Trans
              ns="legal"
              i18nKey="<0>EU/EEA:</0> Your local supervisory authority — <1>edpb.europa.eu</1>"
              components={[
                <strong key="0" />,
                <a
                  key="1"
                  href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
            />
          </p>
          <p className="mt-2">
            <Trans
              ns="legal"
              i18nKey="<0>US:</0> Your state attorney general’s office or the FTC at <1>www.ftc.gov</1>"
              components={[
                <strong key="0" />,
                <a
                  key="1"
                  href="https://www.ftc.gov"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
            />
          </p>
        </div>
      </section>

      {/* 20. Changes to This Policy */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('20. Changes to This Policy')}
        </h2>
        <p className="mt-4 leading-relaxed">
          {t(
            'We may update this Policy to reflect changes in our practices, technology, or legal requirements. Material changes will be posted on our website with an updated “Last Updated” date. Where required by law, we will seek your consent before materially changing how we process your personal information.'
          )}
        </p>
      </section>

      {/* 21. Contact Us */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('21. Contact Us')}
        </h2>
        <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">
          <p className="font-semibold">
            {t('{{value1}} — Data Controller', { value1: SITE_CONFIG.name })}
          </p>
          <p className="mt-1">
            <Trans
              ns="legal"
              i18nKey="Email: <0>{{value1}}</0>"
              components={[
                <a
                  key="0"
                  href={`mailto:${PRIVACY_EMAIL}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
              values={{ value1: PRIVACY_EMAIL }}
            />
          </p>
          <p className="mt-1">
            <Trans
              ns="legal"
              i18nKey="Website: <0>{{value1}}</0>"
              components={[
                <a
                  key="0"
                  href={SITE_CONFIG.url}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {t('Open link', { ns: 'labels' })}
                </a>,
              ]}
              values={{ value1: SITE_CONFIG.url }}
            />
          </p>
        </div>
      </section>
    </main>
  );
}
