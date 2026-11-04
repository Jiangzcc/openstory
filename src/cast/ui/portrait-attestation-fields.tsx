import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
import { AttestationStatementText } from './attestation-statement-text';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  PORTRAIT_RIGHTS_V1,
  type AttestationStatement,
} from '@/platform/compliance/attestations';

type PortraitAttestationFieldsProps = {
  /** Element id prefix; set when two blocks render on one page. */
  id?: string;
  statement?: AttestationStatement;
  attested: boolean;
  onAttestedChange: (attested: boolean) => void;
  authorizationBasis: string;
  onAuthorizationBasisChange: (value: string) => void;
  /** Rendered above the statement, e.g. which tiles it covers. */
  children?: React.ReactNode;
};

export function PortraitAttestationFields({
  id = 'portrait-attestation',
  statement = PORTRAIT_RIGHTS_V1,
  attested,
  onAttestedChange,
  authorizationBasis,
  onAuthorizationBasisChange,
  children,
}: PortraitAttestationFieldsProps) {
  const translateLabel = useLabelTranslation('cast');

  const { t } = useTranslation('cast');

  return (
    <div
      className={
        statement.requiresBasis
          ? 'flex flex-col gap-3 rounded-lg border border-destructive/40 p-4'
          : 'flex flex-col gap-3 rounded-lg border border-border p-4'
      }
    >
      {children}
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={attested}
          onCheckedChange={(checked) => onAttestedChange(checked === true)}
          aria-describedby={`${id}-text`}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor={id} className="leading-snug">
            {translateLabel(statement.label)}
          </Label>
          <AttestationStatementText id={`${id}-text`} text={statement.text} />
        </div>
      </div>
      {statement.requiresBasis ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-basis`}>{t('Basis for authorization')}</Label>
          {/* Multi-line: a basis can be a long sentence. Ctrl/Cmd+Enter confirms. */}
          <Textarea
            id={`${id}-basis`}
            value={authorizationBasis}
            onChange={(event) => onAuthorizationBasisChange(event.target.value)}
            placeholder={t(
              'e.g. signed release on file, this is me, contract #123'
            )}
            autoComplete="off"
            rows={3}
            maxLength={500}
          />
        </div>
      ) : null}
    </div>
  );
}
